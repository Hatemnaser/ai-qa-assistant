import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { createAccountExportPackage } from "../src/modules/data-portability/account-export-package.ts";
import { validateAccountImportPackage } from "../src/modules/data-portability/account-import-package.ts";
import { createAccountImportService } from "../src/modules/data-portability/account-import.service.ts";
import type { AccountImportRepository } from "../src/modules/data-portability/account-import.repository.ts";
import type { ExternalChatImportRepository } from "../src/modules/data-portability/external-chat-import.repository.ts";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.repository.ts";
import { createAccountExportSource } from "./helpers/accountExportPackage.ts";

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

    const serialized = JSON.stringify(packageData);
    assert.doesNotMatch(serialized, /passwordHash/i);
    assert.doesNotMatch(serialized, /conversationSummary/i);
    assert.doesNotMatch(serialized, /embedding/i);
    assert.doesNotMatch(serialized, /indexStatus/i);
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

function hasCode(code: string) {
  return (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === code
    );
}
