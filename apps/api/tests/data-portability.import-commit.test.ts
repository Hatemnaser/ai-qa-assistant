import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  createPrismaDataPortabilityRepository,
  resolveImportedProjectName,
  type DataPortabilityRepository,
} from "../src/modules/data-portability/data-portability.repository.ts";
import { createDataPortabilityService } from "../src/modules/data-portability/data-portability.service.ts";
import { validateProjectImportPackage } from "../src/modules/data-portability/import-package.ts";
import type { ValidatedProjectImportPackage } from "../src/modules/data-portability/data-portability.types.ts";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.repository.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";
import {
  createProjectExportSource,
  createTestProjectExportArchive,
} from "./helpers/projectExportPackage.ts";

describe("project import commit", () => {
  it("creates a new project and restores canonical project data", async () => {
    const archive = createTestProjectExportArchive();
    const digest = createHash("sha256").update(archive).digest("hex");
    const events: string[] = [];
    let capturedPackage: ValidatedProjectImportPackage | undefined;
    const documents = [createImportedDocument()];
    const repository = createCommitRepository({
      createImportedProject: async (userId, packageData) => {
        events.push("transaction-committed");
        capturedPackage = packageData;
        assert.equal(userId, "user-1");

        return {
          projectId: "new-project-1",
          projectName: "Checkout QA (Imported)",
          documents,
          counts: {
            documents: 1,
            chats: 1,
            messages: 2,
          },
        };
      },
      findProjectDocumentIndexStatuses: async (projectId) => {
        assert.equal(projectId, "new-project-1");
        return [
          {
            id: "new-document-1",
            indexStatus: "READY",
          },
        ];
      },
    });
    const service = createDataPortabilityService({
      indexer: {
        async ensureDocumentsIndexed() {},
        async indexDocument() {},
        async indexDocuments(indexedDocuments) {
          assert.deepEqual(events, ["transaction-committed"]);
          assert.deepEqual(indexedDocuments, documents);
          events.push("indexed");
        },
      },
      projectAccess: createFakeProjectAccess(),
      repository,
    });

    const result = await service.commitProjectImport("user-1", archive, digest);

    assert.deepEqual(result, {
      projectId: "new-project-1",
      projectName: "Checkout QA (Imported)",
      imported: {
        documents: 1,
        chats: 1,
        messages: 2,
      },
      warnings: [
        "Chat attachment files are not included because chat file persistence is not implemented. Attachment metadata is included only.",
      ],
    });
    assert.deepEqual(events, ["transaction-committed", "indexed"]);
    assert.equal(capturedPackage?.project.instructions?.content, "Answer as a senior QA engineer.");
    assert.equal(capturedPackage?.project.memory?.content, "Guest checkout is disabled.");
    assert.equal(capturedPackage?.project.documents[0]?.content, '{"guestCheckout":false}\n');
    assert.equal(capturedPackage?.project.chats[0]?.messages.length, 2);
    assert.equal(capturedPackage?.project.chats[0]?.messages[0]?.attachments.length, 1);

    const serialized = JSON.stringify(capturedPackage);
    assert.doesNotMatch(serialized, /conversationSummary/i);
    assert.doesNotMatch(serialized, /embedding/i);
    assert.doesNotMatch(serialized, /indexStatus/i);
    assert.doesNotMatch(serialized, /chunkingVersion/i);
    assert.doesNotMatch(serialized, /passwordHash/i);
    assert.doesNotMatch(serialized, /providerKey/i);
    assert.doesNotMatch(serialized, /usageEvent/i);
  });

  it("rejects a package digest mismatch before database writes", async () => {
    const archive = createTestProjectExportArchive();
    let writeCalls = 0;
    const service = createDataPortabilityService({
      indexer: createNoopIndexer(),
      projectAccess: createFakeProjectAccess(),
      repository: createCommitRepository({
        createImportedProject: async () => {
          writeCalls += 1;
          throw new Error("Digest mismatch must prevent writes.");
        },
      }),
    });

    await assert.rejects(
      service.commitProjectImport("user-1", archive, "0".repeat(64)),
      (error: unknown) => isErrorWithCode(error, "PROJECT_IMPORT_DIGEST_MISMATCH")
    );
    assert.equal(writeCalls, 0);
  });

  it("rejects invalid, unsupported-version, and wrong-type packages safely", async () => {
    const service = createDataPortabilityService({
      indexer: createNoopIndexer(),
      projectAccess: createFakeProjectAccess(),
      repository: createCommitRepository(),
    });
    const invalidPackages = [
      Buffer.from("not-a-zip"),
      rewriteJsonEntry(createTestProjectExportArchive(), "manifest.json", (manifest) => ({
        ...manifest,
        formatVersion: "2.0",
      })),
      rewriteJsonEntry(createTestProjectExportArchive(), "manifest.json", (manifest) => ({
        ...manifest,
        exportType: "account",
      })),
    ];

    for (const archive of invalidPackages) {
      await assert.rejects(
        service.commitProjectImport(
          "user-1",
          archive,
          createHash("sha256").update(archive).digest("hex")
        ),
        (error: unknown) => isErrorWithCode(error, "PROJECT_IMPORT_PACKAGE_INVALID")
      );
    }
  });

  it("rejects packages that try to restore derived state or secrets", async () => {
    const archive = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "data/project.json",
      (projectJson) => ({
        ...projectJson,
        conversationSummary: {
          summary: "Do not restore me.",
        },
        documentChunks: [],
        passwordHash: "not-portable",
        providerKey: "not-portable",
      })
    );
    const service = createDataPortabilityService({
      indexer: createNoopIndexer(),
      projectAccess: createFakeProjectAccess(),
      repository: createCommitRepository(),
    });

    await assert.rejects(
      service.commitProjectImport(
        "user-1",
        archive,
        createHash("sha256").update(archive).digest("hex")
      ),
      (error: unknown) => isErrorWithCode(error, "PROJECT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("keeps an imported project after post-transaction indexing fails", async () => {
    const archive = createTestProjectExportArchive();
    const digest = createHash("sha256").update(archive).digest("hex");
    let transactionCommitted = false;
    const service = createDataPortabilityService({
      indexer: {
        async ensureDocumentsIndexed() {},
        async indexDocument() {},
        async indexDocuments() {
          assert.equal(transactionCommitted, true);
          throw new Error("Index backend unavailable.");
        },
      },
      projectAccess: createFakeProjectAccess(),
      repository: createCommitRepository({
        createImportedProject: async () => {
          transactionCommitted = true;

          return {
            projectId: "new-project-1",
            projectName: "Checkout QA (Imported)",
            documents: [createImportedDocument()],
            counts: {
              documents: 1,
              chats: 1,
              messages: 2,
            },
          };
        },
      }),
    });

    const result = await service.commitProjectImport("user-1", archive, digest);

    assert.equal(result.projectId, "new-project-1");
    assert.equal(transactionCommitted, true);
    assert.match(result.warnings.at(-1) || "", /pending or failed indexing/i);
  });

  it("resolves duplicate imported project names with bounded suffixes", () => {
    assert.equal(resolveImportedProjectName("Checkout QA", []), "Checkout QA (Imported)");
    assert.equal(
      resolveImportedProjectName("Checkout QA", [
        "Checkout QA (Imported)",
        "checkout qa (imported 2)",
      ]),
      "Checkout QA (Imported 3)"
    );
    assert.equal(
      resolveImportedProjectName("A".repeat(120), []).length,
      120
    );
  });

  it("uses one transaction, generates new IDs, and rolls back canonical writes", async () => {
    const packageData = validateProjectImportPackage(createTestProjectExportArchive());
    const successDatabase = createTransactionTestDatabase([
      "Checkout QA (Imported)",
    ]);
    const repository = createPrismaDataPortabilityRepository(
      successDatabase.database as Parameters<
        typeof createPrismaDataPortabilityRepository
      >[0]
    );

    const result = await repository.createImportedProject("user-1", packageData);

    assert.equal(successDatabase.transactionCalls, 1);
    assert.equal(result.projectId, "new-project-1");
    assert.equal(result.projectName, "Checkout QA (Imported 2)");
    assert.notEqual(result.projectId, packageData.project.sourceId);
    assert.equal(successDatabase.state.projects[0]?.ownerId, "user-1");
    assert.equal(successDatabase.state.members[0]?.role, "OWNER");
    assert.equal(successDatabase.state.instructions[0]?.content, "Answer as a senior QA engineer.");
    assert.equal(successDatabase.state.memories[0]?.source, "IMPORTED");
    assert.equal(successDatabase.state.documents[0]?.source, "IMPORTED");
    assert.notEqual(successDatabase.state.documents[0]?.id, packageData.project.documents[0]?.sourceId);
    assert.notEqual(successDatabase.state.chats[0]?.id, packageData.project.chats[0]?.sourceId);
    assert.notEqual(
      successDatabase.state.messages[0]?.id,
      packageData.project.chats[0]?.messages[0]?.sourceId
    );
    const persistedIds = [
      result.projectId,
      ...successDatabase.state.documents.map((document) => document.id),
      ...successDatabase.state.chats.map((chat) => chat.id),
      ...successDatabase.state.messages.map((message) => message.id),
    ];
    const sourceIds = [
      packageData.project.sourceId,
      ...packageData.project.documents.map((document) => document.sourceId),
      ...packageData.project.chats.map((chat) => chat.sourceId),
      ...packageData.project.chats.flatMap((chat) =>
        chat.messages.map((message) => message.sourceId)
      ),
    ];

    assert.equal(new Set(persistedIds).size, persistedIds.length);
    assert.equal(
      persistedIds.some((id) => sourceIds.includes(String(id))),
      false
    );
    assert.equal(
      sourceIds.some((sourceId) =>
        collectStringValues(successDatabase.state).has(sourceId)
      ),
      false
    );
    assert.equal(successDatabase.state.summaries.length, 0);
    assert.equal(successDatabase.state.chunks.length, 0);

    const failingDatabase = createTransactionTestDatabase([], {
      failOnMessages: true,
    });
    const failingRepository = createPrismaDataPortabilityRepository(
      failingDatabase.database as Parameters<
        typeof createPrismaDataPortabilityRepository
      >[0]
    );

    await assert.rejects(
      failingRepository.createImportedProject("user-1", packageData),
      /canonical message write failed/
    );
    assert.equal(failingDatabase.transactionCalls, 1);
    assert.deepEqual(failingDatabase.state.projects, []);
    assert.deepEqual(failingDatabase.state.documents, []);
    assert.deepEqual(failingDatabase.state.chats, []);
    assert.deepEqual(failingDatabase.state.messages, []);
  });
});

function createCommitRepository(
  overrides: Partial<DataPortabilityRepository> = {}
): DataPortabilityRepository {
  return {
    async createImportedProject(_userId, packageData) {
      return {
        projectId: "new-project-1",
        projectName: `${packageData.project.name} (Imported)`,
        documents: packageData.project.documents.map((document, index) =>
          createImportedDocument(`new-document-${index + 1}`, document.title)
        ),
        counts: {
          documents: packageData.project.documents.length,
          chats: packageData.project.chats.length,
          messages: packageData.project.chats.reduce(
            (total, chat) => total + chat.messages.length,
            0
          ),
        },
      };
    },
    async findOwnedProjectExportData() {
      return null;
    },
    async findProjectDocumentIndexStatuses(_projectId, documentIds) {
      return documentIds.map((id) => ({
        id,
        indexStatus: "READY" as const,
      }));
    },
    ...overrides,
  };
}

function createImportedDocument(
  id = "new-document-1",
  title = "requirements.json"
): ProjectDocumentRecord {
  return {
    id,
    projectId: "new-project-1",
    title,
    content: '{"guestCheckout":false}\n',
    source: "IMPORTED",
    mimeType: "application/json",
    metadata: {
      originalName: "requirements.json",
      sizeBytes: 24,
    },
    contentHash: "",
    chunkingVersion: "",
    indexStatus: "PENDING",
    indexError: null,
    indexedAt: null,
    createdAt: new Date("2026-06-24T12:00:00.000Z"),
    updatedAt: new Date("2026-06-24T12:00:00.000Z"),
  };
}

function createNoopIndexer() {
  return {
    async ensureDocumentsIndexed() {},
    async indexDocument() {},
    async indexDocuments() {},
  };
}

function rewriteJsonEntry(
  archive: Buffer,
  path: string,
  mutate: (value: Record<string, unknown>) => Record<string, unknown>
) {
  const entries = unzipSync(archive);
  const entry = entries[path];
  assert.ok(entry);
  const value = JSON.parse(strFromU8(entry)) as Record<string, unknown>;
  entries[path] = strToU8(`${JSON.stringify(mutate(value), null, 2)}\n`);

  return Buffer.from(zipSync(entries));
}

function isErrorWithCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
}

interface TransactionTestState {
  projects: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  instructions: Array<Record<string, unknown>>;
  memories: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  chats: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  summaries: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
}

function createTransactionTestDatabase(
  existingNames: string[],
  options: {
    failOnMessages?: boolean;
  } = {}
) {
  let state = createEmptyTransactionState();
  let transactionCalls = 0;

  const database = {
    async $transaction<T>(
      run: (transaction: Record<string, unknown>) => Promise<T>
    ): Promise<T> {
      transactionCalls += 1;
      const draft = cloneTransactionState(state);
      const transaction = createTransactionClient(draft, existingNames, options);

      try {
        const result = await run(transaction);
        state = draft;
        return result;
      } catch (error) {
        throw error;
      }
    },
  };

  return {
    database,
    get state() {
      return state;
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

function createTransactionClient(
  state: TransactionTestState,
  existingNames: string[],
  options: {
    failOnMessages?: boolean;
  }
) {
  return {
    project: {
      async findMany() {
        return existingNames.map((name) => ({ name }));
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const project = {
          id: `new-project-${state.projects.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.projects.push(project);
        return project;
      },
    },
    projectMember: {
      async create({ data }: { data: Record<string, unknown> }) {
        state.members.push({
          id: `new-member-${state.members.length + 1}`,
          ...data,
        });
      },
    },
    projectInstruction: {
      async create({ data }: { data: Record<string, unknown> }) {
        state.instructions.push(data);
      },
    },
    projectMemory: {
      async create({ data }: { data: Record<string, unknown> }) {
        state.memories.push(data);
      },
    },
    projectDocument: {
      async create({ data }: { data: Record<string, unknown> }) {
        const document = {
          id: `new-document-${state.documents.length + 1}`,
          ...data,
          contentHash: "",
          chunkingVersion: "",
          indexStatus: "PENDING",
          indexError: null,
          indexedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.documents.push(document);
        return document;
      },
    },
    chat: {
      async create({ data }: { data: Record<string, unknown> }) {
        const chat = {
          id: `new-chat-${state.chats.length + 1}`,
          ...data,
        };
        state.chats.push(chat);
        return chat;
      },
    },
    message: {
      async createMany({ data }: { data: Array<Record<string, unknown>> }) {
        const firstMessageSequence = state.messages.length + 1;
        state.messages.push(
          ...data.map((message, index) => ({
            id: `new-message-${firstMessageSequence + index}`,
            ...message,
          }))
        );

        if (options.failOnMessages) {
          throw new Error("canonical message write failed");
        }
      },
    },
  };
}

function createEmptyTransactionState(): TransactionTestState {
  return {
    projects: [],
    members: [],
    instructions: [],
    memories: [],
    documents: [],
    chats: [],
    messages: [],
    summaries: [],
    chunks: [],
  };
}

function cloneTransactionState(state: TransactionTestState): TransactionTestState {
  return {
    projects: [...state.projects],
    members: [...state.members],
    instructions: [...state.instructions],
    memories: [...state.memories],
    documents: [...state.documents],
    chats: [...state.chats],
    messages: [...state.messages],
    summaries: [...state.summaries],
    chunks: [...state.chunks],
  };
}

function collectStringValues(value: unknown, values = new Set<string>()) {
  if (typeof value === "string") {
    values.add(value);
    return values;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, values);
    }
    return values;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStringValues(item, values);
    }
  }

  return values;
}
