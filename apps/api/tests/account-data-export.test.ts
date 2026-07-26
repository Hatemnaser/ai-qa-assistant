import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { prisma } from "../src/db/prisma.ts";
import { createAccountExportPackage } from "../src/modules/data-portability/account-export-package.ts";
import { createPrismaAccountDataPortabilityRepository } from "../src/modules/data-portability/account-data-portability.repository.ts";
import { createAccountDataPortabilityService } from "../src/modules/data-portability/account-data-portability.service.ts";
import { ACCOUNT_EXPORT_LIMITS } from "../src/modules/data-portability/account-data-portability.types.ts";
import type { AccountDataPortabilityRepository } from "../src/modules/data-portability/account-data-portability.repository.ts";
import {
  ACCOUNT_EXPORT_TEST_DATE,
  createAccountExportSource,
} from "./helpers/accountExportPackage.ts";

describe("full Account Data export", () => {
  it("creates a complete portable ZIP with canonical, readable, and migration files", () => {
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
      /attachment files are unavailable/i
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
    const repository = createPrismaAccountDataPortabilityRepository({
      user: {
        async findUnique(args: Record<string, unknown>) {
          query = args;
          const { projects, ...account } = source;

          return {
            ...account,
            ownedProjects: projects,
          };
        },
      },
    } as unknown as typeof prisma);

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
});

function readJson(archive: Buffer, path: string) {
  const entry = unzipSync(archive)[path];
  assert.ok(entry, `${path} must exist`);

  return JSON.parse(strFromU8(entry)) as Record<string, unknown>;
}
