import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { createAccountExportPackage } from "../src/modules/data-portability/account-export-package.ts";
import { validateAccountImportPackage } from "../src/modules/data-portability/account-import-package.ts";
import { createAccountImportService } from "../src/modules/data-portability/account-import.service.ts";
import type { AccountImportRepository } from "../src/modules/data-portability/account-import.types.ts";
import type { ExternalChatImportRepository } from "../src/modules/data-portability/external-chat-import.types.ts";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.types.ts";
import {
  ACCOUNT_EXPORT_BINARY_BYTES,
  createAccountBinaryAssets,
  createAccountExportSource,
} from "./helpers/accountExportPackage.ts";

describe("unified account import", () => {
  it("round-trips this app's account export and preserves canonical relations", () => {
    const archive = createAccountExportPackage(createAccountExportSource()).archive;
    const packageData = validateAccountImportPackage(archive);

    assert.equal(packageData.importKind, "account_archive");
    if (packageData.importKind !== "account_archive") return;

    assert.equal(
      packageData.packageDigest,
      createHash("sha256").update(archive).digest("hex")
    );
    assert.equal(packageData.projects.length, 1);
    assert.equal(packageData.projects[0]?.documents.length, 1);
    assert.equal(packageData.projects[0]?.documents[0]?.content, '{"checkout":true}');
    assert.equal(packageData.chats.length, 1);
    assert.equal(packageData.chats[0]?.messages.length, 2);
    assert.equal(packageData.chats[0]?.sourceProjectId, "project-1");
    assert.deepEqual(packageData.projects[0]?.chatSourceIds, ["chat-1"]);
    assert.equal(packageData.accountMemories.length, 1);
    assert.deepEqual(packageData.binaryAssets, []);

    const serialized = JSON.stringify(packageData);
    assert.doesNotMatch(serialized, /passwordHash/i);
    assert.doesNotMatch(serialized, /conversationSummary/i);
    assert.doesNotMatch(serialized, /embedding/i);
    assert.doesNotMatch(serialized, /indexStatus/i);
  });

  it("validates version 2 binary entries and exposes a safe preview warning", async () => {
    const archive = createAccountExportPackage(
      createAccountExportSource(),
      new Date("2026-08-23T12:00:00.000Z"),
      createAccountBinaryAssets()
    ).archive;
    const packageData = validateAccountImportPackage(archive);

    assert.equal(packageData.importKind, "account_archive");
    if (packageData.importKind !== "account_archive") return;
    assert.equal(packageData.binaryAssets.length, 1);
    assert.deepEqual(packageData.binaryAssets[0]?.bytes, ACCOUNT_EXPORT_BINARY_BYTES);
    assert.equal(packageData.binaryAssets[0]?.binding.kind, "message_attachment");
    assert.match(packageData.warnings.join(" "), /restored atomically/i);

    const preview = await createService().preview(archive);
    assert.equal(preview.counts.binaryAssets, 1);
    assert.match(preview.warnings.join(" "), /restored atomically/i);
  });

  it("validates a project-document source binding against its canonical project", () => {
    const source = createAccountExportSource();
    source.projects[0]!.documents[0]!.metadata = null;
    const binaryAssets = createAccountBinaryAssets();
    binaryAssets.assets[0]!.binding = {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    };
    binaryAssets.assets[0]!.purpose = "PROJECT_DOCUMENT_SOURCE";
    const archive = createAccountExportPackage(
      source,
      new Date("2026-08-23T12:00:00.000Z"),
      binaryAssets
    ).archive;
    const packageData = validateAccountImportPackage(archive);

    assert.equal(packageData.importKind, "account_archive");
    if (packageData.importKind !== "account_archive") return;
    assert.deepEqual(packageData.binaryAssets[0]?.binding, {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    });
  });

  it("rejects version 1 archives containing non-directory asset entries", () => {
    const archive = addManifestedEntry(
      createAccountExportPackage(createAccountExportSource()).archive,
      "assets/001-smuggled.txt",
      strToU8("private bytes")
    );

    assert.throws(
      () => validateAccountImportPackage(archive),
      hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("rejects missing, extra, and tampered version 2 binary entries", () => {
    const archive = createBinaryArchive();
    const mutations: Array<(entries: Record<string, Uint8Array>) => void> = [
      (entries) => {
        delete entries["assets/001-requirements.json"];
      },
      (entries) => {
        entries["assets/999-extra.txt"] = strToU8("extra");
      },
      (entries) => {
        entries["assets/001-requirements.json"] = strToU8('{"tampered":true}');
      },
    ];

    for (const mutate of mutations) {
      const entries = unzipSync(archive);
      mutate(entries);
      assert.throws(
        () => validateAccountImportPackage(Buffer.from(zipSync(entries))),
        hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
      );
    }
  });

  it("rejects duplicate, checksum-tampered, and unrelated binary descriptors", () => {
    const mutators: Array<(account: Record<string, unknown>) => void> = [
      (account) => {
        const descriptors = account.binaryAssets as Array<Record<string, unknown>>;
        descriptors.push(structuredClone(descriptors[0]!));
      },
      (account) => {
        const descriptor = (account.binaryAssets as Array<Record<string, unknown>>)[0]!;
        descriptor.checksumSha256 = "A".repeat(43) + "=";
      },
      (account) => {
        const descriptor = (account.binaryAssets as Array<Record<string, unknown>>)[0]!;
        descriptor.binding = {
          kind: "message_attachment",
          ordinal: 0,
          sourceMessageId: "missing-message",
        };
      },
    ];

    for (const mutate of mutators) {
      const archive = rewriteJsonEntry(
        createBinaryArchive(),
        "data/account.json",
        mutate
      );
      assert.throws(
        () => validateAccountImportPackage(archive),
        hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
      );
    }
  });

  it("rejects account-wide duplicate message and document source IDs", () => {
    const baseArchive = createBinaryArchiveWithMultipleSources();
    const mutations: Array<{
      path: string;
      mutate: (entry: Record<string, unknown>) => void;
    }> = [
      {
        path: "data/chats/chat-002.json",
        mutate(entry) {
          const chat = entry as {
            chat: { messages: Array<{ sourceId: string }> };
          };
          chat.chat.messages[0]!.sourceId = "message-1";
        },
      },
      {
        path: "data/projects/project-002.json",
        mutate(entry) {
          const project = entry as {
            project: { documents: Array<{ sourceId: string }> };
          };
          project.project.documents[0]!.sourceId = "document-1";
        },
      },
    ];

    for (const { path, mutate } of mutations) {
      const archive = rewriteJsonEntry(baseArchive, path, mutate);
      assert.throws(
        () => validateAccountImportPackage(archive),
        hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
      );
    }
  });

  it("rejects binary message bindings whose attachment type contradicts the MIME", () => {
    const archive = rewriteJsonEntry(
      createBinaryArchive(),
      "data/chats/chat-001.json",
      (entry) => {
        const chat = entry as {
          chat: {
            messages: Array<{
              attachments?: Array<{ type: "image" | "file" }>;
            }>;
          };
        };
        chat.chat.messages[0]!.attachments![0]!.type = "image";
      }
    );

    assert.throws(
      () => validateAccountImportPackage(archive),
      hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("rejects binary document bindings with a mismatched title fallback or MIME", () => {
    const source = createAccountExportSource();
    source.projects[0]!.documents[0]!.metadata = null;
    const binaryAssets = createAccountBinaryAssets();
    binaryAssets.assets[0]!.binding = {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    };
    binaryAssets.assets[0]!.purpose = "PROJECT_DOCUMENT_SOURCE";
    const baseArchive = createAccountExportPackage(
      source,
      new Date("2026-08-23T12:00:00.000Z"),
      binaryAssets
    ).archive;
    const mutations: Array<(entry: Record<string, unknown>) => void> = [
      (entry) => {
        const project = entry as {
          project: { documents: Array<{ title: string }> };
        };
        project.project.documents[0]!.title = "other.json";
      },
      (entry) => {
        const project = entry as {
          project: { documents: Array<{ mimeType: string | null }> };
        };
        project.project.documents[0]!.mimeType = null;
      },
    ];

    for (const mutate of mutations) {
      const archive = rewriteJsonEntry(
        baseArchive,
        "data/projects/project-001.json",
        mutate
      );
      assert.throws(
        () => validateAccountImportPackage(archive),
        hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
      );
    }
  });

  it("rejects mixed package versions across canonical entries", () => {
    const archive = rewriteJsonEntry(
      createBinaryArchive(),
      "data/chats/chat-001.json",
      (chat) => {
        chat.formatVersion = "1.0";
      }
    );

    assert.throws(
      () => validateAccountImportPackage(archive),
      hasCode("ACCOUNT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("auto-detects a supported external chat archive without source input", () => {
    const packageData = validateAccountImportPackage(createExternalArchive());

    assert.equal(packageData.importKind, "chat_archive");
    if (packageData.importKind !== "chat_archive") return;
    assert.equal(packageData.external.provider, "chatgpt");
    assert.equal(packageData.external.chats.length, 1);
    assert.equal(packageData.external.chats[0]?.messages.length, 1);
  });

  it("previews with zero writes and rejects digest mismatch before commit", async () => {
    const archive = createAccountExportPackage(createAccountExportSource()).archive;
    let accountWrites = 0;
    let externalWrites = 0;
    const service = createService({
      accountRepository: createAccountRepository({
        async createImportedAccount() {
          accountWrites += 1;
          return createPersistedResult();
        },
      }),
      externalRepository: {
        async createImportedChats() {
          externalWrites += 1;
          return { chats: 0, messages: 0 };
        },
      },
    });

    const preview = await service.preview(archive);

    assert.deepEqual(preview.counts, {
      projects: 1,
      documents: 1,
      chats: 1,
      messages: 2,
      accountMemories: 1,
    });
    assert.equal(accountWrites, 0);
    assert.equal(externalWrites, 0);

    await assert.rejects(
      () => service.commit("user-1", archive, "0".repeat(64)),
      hasCode("ACCOUNT_IMPORT_DIGEST_MISMATCH")
    );
    assert.equal(accountWrites, 0);
    assert.equal(externalWrites, 0);
  });

  it("commits native records before starting best-effort document indexing", async () => {
    const archive = createAccountExportPackage(createAccountExportSource()).archive;
    const digest = createHash("sha256").update(archive).digest("hex");
    const events: string[] = [];
    const service = createAccountImportService({
      accountRepository: createAccountRepository({
        async createImportedAccount(userId, packageData) {
          assert.equal(userId, "user-1");
          assert.equal(packageData.projects[0]?.sourceId, "project-1");
          events.push("transaction");
          return createPersistedResult();
        },
        async findDocumentIndexStatuses() {
          return [{ id: "new-document-1", indexStatus: "READY" }];
        },
      }),
      externalRepository: createExternalRepository(),
      indexer: {
        async ensureDocumentsIndexed() {},
        async indexDocument() {},
        async indexDocuments(documents) {
          assert.deepEqual(events, ["transaction"]);
          assert.equal(documents[0]?.id, "new-document-1");
          events.push("indexed");
        },
      },
    });

    const result = await service.commit("user-1", archive, digest);

    assert.equal(result.importKind, "account_archive");
    assert.deepEqual(result.imported, createPersistedResult().counts);
    assert.deepEqual(events, ["transaction", "indexed"]);
  });
});

function createService(overrides: {
  accountRepository?: AccountImportRepository;
  externalRepository?: ExternalChatImportRepository;
} = {}) {
  return createAccountImportService({
    accountRepository: overrides.accountRepository || createAccountRepository(),
    externalRepository: overrides.externalRepository || createExternalRepository(),
    indexer: {
      async ensureDocumentsIndexed() {},
      async indexDocument() {},
      async indexDocuments() {},
    },
  });
}

function createAccountRepository(
  overrides: Partial<AccountImportRepository> = {}
): AccountImportRepository {
  return {
    async createImportedAccount() {
      return createPersistedResult();
    },
    async findDocumentIndexStatuses(documentIds) {
      return documentIds.map((id) => ({ id, indexStatus: "READY" as const }));
    },
    ...overrides,
  };
}

function createExternalRepository(): ExternalChatImportRepository {
  return {
    async createImportedChats(_userId, packageData) {
      return {
        chats: packageData.chats.length,
        messages: packageData.chats.reduce(
          (total, chat) => total + chat.messages.length,
          0
        ),
      };
    },
  };
}

function createPersistedResult() {
  return {
    counts: {
      projects: 1,
      documents: 1,
      chats: 1,
      messages: 2,
      accountMemories: 1,
    },
    skippedAccountMemories: 0,
    documents: [createDocument()],
  };
}

function createDocument(): ProjectDocumentRecord {
  return {
    id: "new-document-1",
    projectId: "new-project-1",
    title: "requirements.json",
    content: '{"checkout":true}',
    source: "IMPORTED",
    sourceAssetId: null,
    mimeType: "application/json",
    metadata: null,
    contentHash: "",
    chunkingVersion: "",
    indexStatus: "PENDING",
    indexError: null,
    indexedAt: null,
    createdAt: new Date("2026-07-03T12:00:00.000Z"),
    updatedAt: new Date("2026-07-03T12:00:00.000Z"),
  };
}

function createExternalArchive() {
  return Buffer.from(
    zipSync({
      "conversations.json": strToU8(
        JSON.stringify([
          {
            id: "conversation-1",
            title: "Imported conversation",
            current_node: "message-1",
            mapping: {
              "message-1": {
                id: "message-1",
                parent: null,
                message: {
                  id: "source-message-1",
                  author: { role: "user" },
                  content: { parts: ["Hello"] },
                },
              },
            },
          },
        ])
      ),
    })
  );
}

function createBinaryArchive() {
  return createAccountExportPackage(
    createAccountExportSource(),
    new Date("2026-08-23T12:00:00.000Z"),
    createAccountBinaryAssets()
  ).archive;
}

function createBinaryArchiveWithMultipleSources() {
  const source = createAccountExportSource();
  const firstProject = source.projects[0]!;
  const firstChat = source.chats[0]!;
  source.projects.push({
    ...firstProject,
    id: "project-2",
    name: "Second project",
    documents: firstProject.documents.map((document) => ({
      ...document,
      id: "document-2",
      title: "second-requirements.json",
      metadata: {
        originalName: "second-requirements.json",
        sizeBytes: 17,
      },
    })),
  });
  source.chats.push({
    ...firstChat,
    id: "chat-2",
    projectId: "project-2",
    title: "Second chat",
    messages: firstChat.messages.map((message, index) => ({
      ...message,
      id: `message-${index + 3}`,
      attachment: null,
    })),
  });

  return createAccountExportPackage(
    source,
    new Date("2026-08-23T12:00:00.000Z"),
    createAccountBinaryAssets()
  ).archive;
}

function addManifestedEntry(
  archive: Buffer,
  path: string,
  content: Uint8Array
) {
  const entries = unzipSync(archive);
  const entryContent = Uint8Array.from(content);
  const manifestEntry = entries["manifest.json"];
  assert.ok(manifestEntry);
  const manifest = JSON.parse(strFromU8(manifestEntry)) as {
    files: Array<{ path: string; sha256: string; sizeBytes: number }>;
  };

  entries[path] = entryContent;
  manifest.files.push({
    path,
    sha256: createHash("sha256").update(entryContent).digest("hex"),
    sizeBytes: entryContent.byteLength,
  });
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  return Buffer.from(zipSync(entries));
}

function rewriteJsonEntry(
  archive: Buffer,
  path: string,
  mutate: (value: Record<string, unknown>) => void
) {
  const entries = unzipSync(archive);
  const entry = entries[path];
  const manifestEntry = entries["manifest.json"];
  assert.ok(entry);
  assert.ok(manifestEntry);

  const value = JSON.parse(strFromU8(entry)) as Record<string, unknown>;
  mutate(value);
  const content = strToU8(`${JSON.stringify(value, null, 2)}\n`);
  entries[path] = content;

  const manifest = JSON.parse(strFromU8(manifestEntry)) as {
    files: Array<{ path: string; sha256: string; sizeBytes: number }>;
  };
  const manifestFile = manifest.files.find((file) => file.path === path);
  assert.ok(manifestFile);
  manifestFile.sha256 = createHash("sha256").update(content).digest("hex");
  manifestFile.sizeBytes = content.byteLength;
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  return Buffer.from(zipSync(entries));
}

function hasCode(code: string) {
  return (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === code
    );
}
