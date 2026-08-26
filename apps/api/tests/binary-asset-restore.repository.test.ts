import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaBinaryAssetRestoreRepository } from "../src/modules/data-portability/binary-asset-restore.repository.ts";
import type { BinaryAssetRestoreReservation } from "../src/modules/data-portability/binary-asset-restore.types.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const CLEANUP_AT = new Date("2026-08-23T12:30:00.000Z");

describe("binary asset restore repository", () => {
  it("reserves quota and durable deletion work in one serializable transaction", async () => {
    const calls: Record<string, unknown> = {};
    const created: unknown[] = [];
    const jobs: unknown[] = [];
    const sessions: unknown[] = [];
    const tx = {
      async $executeRaw(_parts: TemplateStringsArray, lockId: string) {
        const locks = (calls.locks as string[] | undefined) || [];
        locks.push(lockId);
        calls.locks = locks;
        return 1;
      },
      binaryAssetRestoreSession: {
        async create(input: unknown) { sessions.push(input); },
        async findUnique() { return null; },
      },
      objectDeletionJob: {
        async createMany(input: unknown) { jobs.push(input); return { count: 1 }; },
      },
      storedAsset: {
        async aggregate(input: unknown) {
          calls.aggregate = input;
          return { _sum: { expectedSizeBytes: 100 } };
        },
        async create(input: unknown) { created.push(input); },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>, options: unknown) {
        calls.options = options;
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await createPrismaBinaryAssetRestoreRepository(database).stage(
      "user-1",
      [reservation()],
      NOW,
      CLEANUP_AT,
      1_000
    );

    assert.deepEqual(calls.locks, ["user-1", "oddpath:asset-restore:session-1"]);
    assert.deepEqual(calls.options, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 60_000,
    });
    assert.deepEqual(calls.aggregate, {
      _sum: { expectedSizeBytes: true },
      where: { ownerId: "user-1" },
    });
    assert.deepEqual((created[0] as { data: unknown }).data, {
      checksumSha256: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
      declaredMimeType: "text/plain",
      expectedSizeBytes: 128,
      id: "asset-1",
      objectKey: "chat-attachments/restore-1",
      originalName: "note.txt",
      ownerId: "user-1",
      projectId: null,
      purpose: "CHAT_ATTACHMENT",
      restoreAttempt: 1,
      restoreSessionId: "session-1",
      uploadExpiresAt: CLEANUP_AT,
    });
    assert.deepEqual((sessions[0] as { data: unknown }).data, {
      attempt: 1,
      attemptToken: "attempt-token-1",
      id: "session-1",
      leaseExpiresAt: CLEANUP_AT,
      ownerId: "user-1",
    });
    assert.equal(jobs.length, 1);
    const jobWrite = jobs[0] as {
      data: Array<{ nextAttemptAt: Date; objectKey: string }>;
      skipDuplicates: boolean;
    };
    assert.equal(jobWrite.skipDuplicates, true);
    assert.equal(jobWrite.data.length, 1);
    assert.equal(jobWrite.data[0]?.objectKey, "chat-attachments/restore-1");
    assert.equal(jobWrite.data[0]?.nextAttemptAt instanceof Date, true);
  });

  it("rejects quota overflow before creating staged rows", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async create() {},
        async findUnique() { return null; },
      },
      storedAsset: {
        async aggregate() { return { _sum: { expectedSizeBytes: 950 } }; },
        async create() { created = true; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaBinaryAssetRestoreRepository(database).stage(
        "user-1",
        [reservation()],
        NOW,
        CLEANUP_AT,
        1_000
      ),
      (error: unknown) => hasCode(error, "ASSET_QUOTA_REACHED")
    );
    assert.equal(created, false);
  });

  it("accepts only the exact live session, attempt, staged rows, and deletion jobs", async () => {
    let sessionWhere: unknown;
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async findFirst(input: { where: unknown }) {
          sessionWhere = input.where;
          return { id: "session-1" };
        },
      },
      objectDeletionJob: {
        async findMany() {
          return [{ objectKey: "chat-attachments/restore-1" }];
        },
      },
      storedAsset: {
        async findMany() {
          return [{
            id: "asset-1",
            objectKey: "chat-attachments/restore-1",
            restoreAttempt: 1,
            restoreSessionId: "session-1",
          }];
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaBinaryAssetRestoreRepository(database)
        .assertAttemptActive("user-1", [reservation()], NOW),
      true
    );
    assert.deepEqual(sessionWhere, {
      attempt: 1,
      attemptToken: "attempt-token-1",
      id: "session-1",
      leaseExpiresAt: { gt: NOW },
      ownerId: "user-1",
    });
  });

  it("rejects a stale attempt before reading its staged rows", async () => {
    let readStages = false;
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async findFirst() { return null; },
      },
      objectDeletionJob: {
        async findMany() { throw new Error("must not read jobs"); },
      },
      storedAsset: {
        async findMany() { readStages = true; return []; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaBinaryAssetRestoreRepository(database)
        .assertAttemptActive("user-1", [reservation()], NOW),
      false
    );
    assert.equal(readStages, false);
  });

  it("atomically marks exact unlinked stages and their jobs due for cleanup", async () => {
    const calls: Record<string, unknown> = {};
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async findFirst() { return { id: "session-1" }; },
      },
      objectDeletionJob: {
        async createMany(input: unknown) { calls.jobCreateMany = input; return { count: 1 }; },
        async updateMany(input: unknown) { calls.job = input; },
      },
      storedAsset: {
        async findUnique() {
          return {
            id: "asset-1",
            messageAttachment: null,
            objectKey: "chat-attachments/restore-1",
            ownerId: "user-1",
            restoreAttempt: 1,
            restoreSessionId: "session-1",
            sourceDocument: null,
            status: "PENDING",
          };
        },
        async updateMany(input: unknown) { calls.asset = input; return { count: 1 }; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const claimed = await createPrismaBinaryAssetRestoreRepository(database).markForCleanup(
      "user-1",
      [reservation()],
      NOW
    );

    assert.deepEqual(claimed, ["chat-attachments/restore-1"]);

    assert.deepEqual(calls.asset, {
      data: { status: "DELETE_PENDING", uploadExpiresAt: null },
      where: {
        id: "asset-1",
        messageAttachment: null,
        objectKey: "chat-attachments/restore-1",
        ownerId: "user-1",
        restoreAttempt: 1,
        restoreSessionId: "session-1",
        sourceDocument: null,
        status: "PENDING",
      },
    });
    assert.deepEqual(calls.job, {
      data: { nextAttemptAt: NOW },
      where: { objectKey: { in: ["chat-attachments/restore-1"] } },
    });
  });

  it("recreates a detached deletion job after a late provider acknowledgement", async () => {
    const calls: Record<string, unknown> = {};
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async findFirst() { return null; },
      },
      objectDeletionJob: {
        async createMany(input: unknown) { calls.createMany = input; return { count: 1 }; },
        async updateMany(input: unknown) { calls.update = input; },
      },
      storedAsset: {
        async findUnique() { return null; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const claimed = await createPrismaBinaryAssetRestoreRepository(database)
      .markForCleanup("user-1", [reservation()], CLEANUP_AT);

    assert.deepEqual(claimed, ["chat-attachments/restore-1"]);
    assert.deepEqual(calls.update, {
      data: { nextAttemptAt: CLEANUP_AT },
      where: { objectKey: { in: ["chat-attachments/restore-1"] } },
    });
    assert.deepEqual(calls.createMany, {
      data: [{
        nextAttemptAt: CLEANUP_AT,
        objectKey: "chat-attachments/restore-1",
      }],
      skipDuplicates: true,
    });
  });

  it("does not let a stale attempt cleanup a live session", async () => {
    let mutated = false;
    const tx = {
      async $executeRaw() { return 1; },
      binaryAssetRestoreSession: {
        async findFirst() { return null; },
      },
      objectDeletionJob: {
        async updateMany() { mutated = true; },
        async createMany() { mutated = true; return { count: 1 }; },
      },
      storedAsset: {
        async findUnique() {
          return {
            id: "asset-1",
            messageAttachment: null,
            objectKey: "chat-attachments/restore-1",
            ownerId: "user-1",
            restoreAttempt: 1,
            restoreSessionId: "session-1",
            sourceDocument: null,
            status: "PENDING",
          };
        },
        async updateMany() { mutated = true; return { count: 1 }; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.deepEqual(
      await createPrismaBinaryAssetRestoreRepository(database)
        .markForCleanup("user-1", [reservation()], CLEANUP_AT),
      []
    );
    assert.equal(mutated, false);
  });

});

function reservation(): BinaryAssetRestoreReservation {
  return {
    assetId: "asset-1",
    descriptor: {
      binding: { kind: "message_attachment", ordinal: 0, sourceMessageId: "message-1" },
      checksumSha256: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
      file: { path: "assets/001-note.txt", sha256: "a".repeat(64), sizeBytes: 128 },
      mimeType: "text/plain",
      originalName: "note.txt",
      purpose: "CHAT_ATTACHMENT",
      sizeBytes: 128,
      sourceAssetId: "source-asset-1",
      sourceProjectId: null,
    },
    fence: {
      attempt: 1,
      attemptToken: "attempt-token-1",
      sessionId: "session-1",
    },
    objectKey: "chat-attachments/restore-1",
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
