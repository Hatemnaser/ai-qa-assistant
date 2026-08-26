import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { DATA_LIMITS } from "../src/config/data-limits.ts";
import { prisma } from "../src/db/prisma.ts";
import { createAccountExportPackage } from "../src/modules/data-portability/account-export-package.ts";
import { createPrismaAccountDataPortabilityRepository } from "../src/modules/data-portability/account-data-portability.repository.ts";
import { createAccountDataPortabilityService } from "../src/modules/data-portability/account-data-portability.service.ts";
import {
  ACCOUNT_EXPORT_LIMITS,
  type AccountDataPortabilityRepository,
} from "../src/modules/data-portability/account-data-portability.types.ts";
import {
  ACCOUNT_EXPORT_BINARY_BYTES,
  ACCOUNT_EXPORT_TEST_DATE,
  createAccountBinaryAssets,
  createAccountExportSource,
} from "./helpers/accountExportPackage.ts";

describe("full Account Data export", () => {
  it("keeps synchronous export within the single-instance MVP memory budget", () => {
    assert.deepEqual(ACCOUNT_EXPORT_LIMITS, {
      maxArchiveBytes: 10_000_000,
      maxEntries: 600,
      maxEntryBytes: 5_000_000,
      maxTotalEntryBytes: 20_000_000,
      maxProjects: DATA_LIMITS.projectsPerUser,
      maxDocuments:
        DATA_LIMITS.projectsPerUser * DATA_LIMITS.documentsPerProject,
      maxChats: DATA_LIMITS.chatsPerUser,
      maxMessages: DATA_LIMITS.chatsPerUser * DATA_LIMITS.messagesPerChat,
      maxMessagesPerChat: DATA_LIMITS.messagesPerChat,
      maxAccountMemories: DATA_LIMITS.accountMemoriesPerUser,
      maxMessageChars: DATA_LIMITS.chatMessageContentChars,
      maxDocumentBytes: DATA_LIMITS.projectDocumentSourceBytes,
      maxTotalTextChars: 5_000_000,
    });
  });

  it("creates a bounded portable ZIP with canonical, readable, and migration files", () => {
    const result = createAccountExportPackage(
      createAccountExportSource(),
      ACCOUNT_EXPORT_TEST_DATE
    );
    const entries = unzipSync(result.archive);

    assert.equal(result.downloadFilename, "account-data-export.zip");
    assert.ok(entries["manifest.json"]);
    assert.ok(entries["data/account.json"]);
    assert.ok(entries["data/projects/project-001.json"]);
    assert.ok(entries["data/chats/chat-001.json"]);
    assert.ok(
      entries["documents/project-001/001-requirements.json"]
    );
    assert.ok(entries["readable/account.md"]);
    assert.ok(entries["readable/account-memory.md"]);
    assert.ok(entries["readable/projects/project-001.md"]);
    assert.ok(entries["readable/chats/chat-001.md"]);
    assert.ok(entries["migration/conversations.json"]);
    assert.ok(entries["migration/account-memory.md"]);
    assert.ok(entries["migration/README.md"]);
  });

  it("exports every canonical account area and excludes derived state and secrets", () => {
    const result = createAccountExportPackage(createAccountExportSource());
    const account = readJson(result.archive, "data/account.json");
    const project = readJson(
      result.archive,
      "data/projects/project-001.json"
    );
    const chat = readJson(result.archive, "data/chats/chat-001.json");
    const serialized = JSON.stringify({
      account,
      project,
      chat,
    });

    assert.equal((account.account as { email?: string }).email, "owner@example.com");
    assert.equal(
      (account.account as { acceptedTermsVersion?: string }).acceptedTermsVersion,
      "2026-01-01"
    );
    assert.equal(
      (account.account as { acceptedTermsAt?: string }).acceptedTermsAt,
      "2026-01-01T09:59:00.000Z"
    );
    assert.equal(
      (account.settings as { defaultModel?: string }).defaultModel,
      "gemini-3.1-flash-lite"
    );
    assert.equal(
      (account.accountMemories as unknown[]).length,
      1
    );
    assert.equal(
      ((project.project as { documents?: unknown[] }).documents || []).length,
      1
    );
    assert.equal(
      ((chat.chat as { messages?: unknown[] }).messages || []).length,
      2
    );

    assert.doesNotMatch(serialized, /passwordHash/i);
    assert.doesNotMatch(serialized, /session/i);
    assert.doesNotMatch(serialized, /tokenHash/i);
    assert.doesNotMatch(serialized, /conversationSummary/i);
    assert.doesNotMatch(serialized, /embedding/i);
    assert.doesNotMatch(serialized, /indexStatus/i);
    assert.doesNotMatch(serialized, /chunkingVersion/i);
    assert.doesNotMatch(serialized, /usageEvent/i);
    assert.doesNotMatch(serialized, /providerKey/i);
    assert.doesNotMatch(serialized, /billingSecret/i);
  });

  it("writes hashes, counts, and truthful attachment/migration warnings", () => {
    const result = createAccountExportPackage(
      createAccountExportSource(),
      ACCOUNT_EXPORT_TEST_DATE
    );
    const entries = unzipSync(result.archive);
    const manifest = readJson(result.archive, "manifest.json");

    assert.equal(manifest.formatVersion, "1.0");
    assert.equal(manifest.exportType, "account");
    assert.equal(manifest.exportedAt, ACCOUNT_EXPORT_TEST_DATE.toISOString());
    assert.deepEqual(manifest.counts, {
      projects: 1,
      documents: 1,
      chats: 1,
      messages: 2,
      accountMemories: 1,
    });
    assert.deepEqual(manifest.contains, {
      canonicalJson: true,
      readableMarkdown: true,
      migrationReference: true,
      attachmentFiles: false,
      derivedData: false,
      secrets: false,
    });
    assert.match(
      (manifest.warnings as string[]).join(" "),
      /attachment files are not included/i
    );
    assert.match(
      (manifest.warnings as string[]).join(" "),
      /private object-storage binaries are not included/i
    );
    assert.match(
      (manifest.warnings as string[]).join(" "),
      /does not guarantee restoration/i
    );

    const files = manifest.files as Array<{
      path: string;
      sha256: string;
      sizeBytes: number;
    }>;
    const accountFile = files.find((file) => file.path === "data/account.json");
    assert.ok(accountFile);
    assert.equal(accountFile.sizeBytes, entries["data/account.json"]?.byteLength);
    assert.equal(
      accountFile.sha256,
      createHash("sha256")
        .update(entries["data/account.json"]!)
        .digest("hex")
    );
  });

  it("emits a version 2 archive with bounded binary descriptors and entries when supplied", () => {
    const result = createAccountExportPackage(
      createAccountExportSource(),
      ACCOUNT_EXPORT_TEST_DATE,
      createAccountBinaryAssets()
    );
    const entries = unzipSync(result.archive);
    const manifest = readJson(result.archive, "manifest.json");
    const account = readJson(result.archive, "data/account.json");

    assert.equal(manifest.formatVersion, "2.0");
    assert.equal(
      (manifest.counts as { binaryAssets?: number }).binaryAssets,
      1
    );
    assert.deepEqual(manifest.contains, {
      canonicalJson: true,
      readableMarkdown: true,
      migrationReference: true,
      attachmentFiles: true,
      privateAssetFiles: true,
      derivedData: false,
      secrets: false,
    });
    assert.deepEqual(
      entries["assets/001-requirements.json"],
      ACCOUNT_EXPORT_BINARY_BYTES
    );
    assert.equal((account.binaryAssets as unknown[]).length, 1);
    assert.doesNotMatch(
      (manifest.warnings as string[]).join(" "),
      /binaries are not included/i
    );
    assert.match(
      (manifest.warnings as string[]).join(" "),
      /atomic binary-asset restore/i
    );
  });

  it("rejects binary descriptors that do not bind to canonical account data", () => {
    const binaryAssets = createAccountBinaryAssets();
    binaryAssets.assets[0]!.binding = {
      kind: "message_attachment",
      ordinal: 0,
      sourceMessageId: "missing-message",
    };

    assert.throws(
      () =>
        createAccountExportPackage(
          createAccountExportSource(),
          ACCOUNT_EXPORT_TEST_DATE,
          binaryAssets
        ),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ACCOUNT_EXPORT_BINARY_ASSETS_INVALID"
        )
    );
  });

  it("rejects account-wide duplicate message and document source IDs for binary exports", () => {
    const duplicateMessageSource = createAccountExportSource();
    const firstChat = duplicateMessageSource.chats[0]!;
    duplicateMessageSource.chats.push({
      ...firstChat,
      id: "chat-2",
      title: "Duplicate message source",
      messages: [
        {
          ...firstChat.messages[0]!,
          id: "message-1",
          attachment: null,
        },
      ],
    });

    const duplicateDocumentSource = createAccountExportSource();
    const firstProject = duplicateDocumentSource.projects[0]!;
    duplicateDocumentSource.projects.push({
      ...firstProject,
      id: "project-2",
      name: "Duplicate document source",
      documents: [
        {
          ...firstProject.documents[0]!,
          id: "document-1",
        },
      ],
    });

    for (const account of [duplicateMessageSource, duplicateDocumentSource]) {
      assert.throws(
        () =>
          createAccountExportPackage(
            account,
            ACCOUNT_EXPORT_TEST_DATE,
            createAccountBinaryAssets()
          ),
        hasCode("ACCOUNT_EXPORT_BINARY_ASSETS_INVALID")
      );
    }
  });

  it("requires message attachment type to match the binary MIME", () => {
    const account = createAccountExportSource();
    account.chats[0]!.messages[0]!.attachment = [
      {
        type: "image",
        name: "requirements.json",
        mimeType: "application/json",
      },
    ];

    assert.throws(
      () =>
        createAccountExportPackage(
          account,
          ACCOUNT_EXPORT_TEST_DATE,
          createAccountBinaryAssets()
        ),
      hasCode("ACCOUNT_EXPORT_BINARY_ASSETS_INVALID")
    );
  });

  it("uses the document title as the binary name fallback and matches MIME exactly", () => {
    const binaryAssets = createAccountBinaryAssets();
    binaryAssets.assets[0]!.binding = {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    };
    binaryAssets.assets[0]!.purpose = "PROJECT_DOCUMENT_SOURCE";

    const fallbackAccount = createAccountExportSource();
    fallbackAccount.projects[0]!.documents[0]!.metadata = null;
    assert.doesNotThrow(() =>
      createAccountExportPackage(
        fallbackAccount,
        ACCOUNT_EXPORT_TEST_DATE,
        binaryAssets
      )
    );

    const wrongName = createAccountExportSource();
    wrongName.projects[0]!.documents[0]!.metadata = null;
    wrongName.projects[0]!.documents[0]!.title = "other.json";

    const missingMime = createAccountExportSource();
    missingMime.projects[0]!.documents[0]!.metadata = null;
    missingMime.projects[0]!.documents[0]!.mimeType = null;

    for (const account of [wrongName, missingMime]) {
      assert.throws(
        () =>
          createAccountExportPackage(
            account,
            ACCOUNT_EXPORT_TEST_DATE,
            binaryAssets
          ),
        hasCode("ACCOUNT_EXPORT_BINARY_ASSETS_INVALID")
      );
    }
  });

  it("creates a provider-neutral conversation reference without claiming native restore", () => {
    const result = createAccountExportPackage(createAccountExportSource());
    const migration = readJson(
      result.archive,
      "migration/conversations.json"
    );
    const conversations = migration.conversations as Array<{
      title: string;
      messages: Array<{ role: string; content: string }>;
    }>;

    assert.equal(migration.exportType, "conversation_reference");
    assert.equal(conversations[0]?.title, "Checkout test cases");
    assert.deepEqual(
      conversations[0]?.messages.map((message) => message.role),
      ["user", "assistant"]
    );
  });

  it("loads only the authenticated account through the service", async () => {
    const calls: string[] = [];
    const repository: AccountDataPortabilityRepository = {
      async findAccountExportData(userId) {
        calls.push(userId);
        return createAccountExportSource();
      },
    };
    const service = createAccountDataPortabilityService({
      now: () => ACCOUNT_EXPORT_TEST_DATE,
      repository,
    });

    const result = await service.exportAccountData("user-1");

    assert.deepEqual(calls, ["user-1"]);
    assert.equal(result.manifest.accountId, "user-1");
  });

  it("queries the authenticated owner and only canonical Account Memory sources", async () => {
    const source = createAccountExportSource();
    let query: Record<string, unknown> | undefined;
    let assetQuery: Record<string, unknown> | undefined;
    let documentQuery: Record<string, unknown> | undefined;
    let messageQuery: Record<string, unknown> | undefined;
    const database = {
      async $transaction(
        callback: (transaction: Record<string, unknown>) => Promise<unknown>
      ) {
        return callback(database);
      },
      message: {
        async findMany(args: Record<string, unknown>) {
          messageQuery = args;
          return source.chats.flatMap((chat) =>
            chat.messages.map((message) => ({
              ...message,
              attachments: [],
              chatId: chat.id,
            }))
          );
        },
      },
      projectDocument: {
        async findMany(args: Record<string, unknown>) {
          documentQuery = args;
          return source.projects.flatMap((project) =>
            project.documents.map((document) => ({
              ...document,
              projectId: project.id,
              sourceAssetId: null,
            }))
          );
        },
      },
      storedAsset: {
        async findMany(args: Record<string, unknown>) {
          assetQuery = args;
          return [];
        },
      },
      user: {
        async findUnique(args: Record<string, unknown>) {
          query = args;
          const { projects, ...account } = source;

          return {
            ...account,
            chats: account.chats.map(({ messages: _messages, ...chat }) => chat),
            ownedProjects: projects.map(
              ({ documents: _documents, ...project }) => project
            ),
          };
        },
      },
    };
    const repository = createPrismaAccountDataPortabilityRepository(
      database as unknown as typeof prisma
    );

    const result = await repository.findAccountExportData("user-1");

    assert.deepEqual(query?.where, {
      id: "user-1",
    });
    const select = query?.select as {
      memories?: {
        where?: {
          scope?: string;
          source?: {
            in?: string[];
          };
        };
      };
    };
    assert.equal(select.memories?.where?.scope, "USER");
    assert.deepEqual(select.memories?.where?.source?.in, [
      "USER_PROVIDED",
      "IMPORTED",
    ]);
    assert.deepEqual(
      (assetQuery?.where as { ownerId?: string; status?: string }) || {},
      {
        OR: [
          { messageAttachment: { message: { chat: { userId: "user-1" } } } },
          { sourceDocument: { project: { ownerId: "user-1" } } },
        ],
        ownerId: "user-1",
      }
    );
    assert.equal(
      ((documentQuery?.select as { sourceAssetId?: boolean }) || {})
        .sourceAssetId,
      true
    );
    assert.deepEqual(
      (messageQuery?.select as { attachments?: unknown }).attachments,
      {
        orderBy: { ordinal: "asc" },
        select: { assetId: true, ordinal: true },
      }
    );
    assert.equal(
      Object.hasOwn(result?.projects[0]?.documents[0] || {}, "sourceAssetId"),
      false
    );
    assert.equal(
      Object.hasOwn(result?.chats[0]?.messages[0] || {}, "attachments"),
      false
    );
    assert.equal(result?.projects[0]?.id, "project-1");
  });

  it("returns a safe not-found error if the authenticated account disappeared", async () => {
    const service = createAccountDataPortabilityService({
      repository: {
        async findAccountExportData() {
          return null;
        },
      },
    });

    await assert.rejects(
      () => service.exportAccountData("missing-user"),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ACCOUNT_NOT_FOUND"
        )
    );
  });

  it("rejects an account export entry that exceeds the in-memory package limit", () => {
    const account = createAccountExportSource();
    account.projects[0]!.documents[0]!.content = "x".repeat(
      ACCOUNT_EXPORT_LIMITS.maxEntryBytes + 1
    );

    assert.throws(
      () => createAccountExportPackage(account),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ACCOUNT_EXPORT_TOO_LARGE"
        )
    );
  });

  it("rejects message content outside the shared persisted-data limits", () => {
    const account = createAccountExportSource();
    account.chats[0]!.messages[0]!.content = "x".repeat(
      DATA_LIMITS.chatMessageContentChars + 1
    );

    assert.throws(
      () => createAccountExportPackage(account),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ACCOUNT_EXPORT_TOO_LARGE"
        )
    );
  });
});

function readJson(archive: Buffer, path: string) {
  const entry = unzipSync(archive)[path];
  assert.ok(entry, `${path} must exist`);

  return JSON.parse(strFromU8(entry)) as Record<string, unknown>;
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
