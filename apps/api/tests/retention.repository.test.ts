import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaRetentionRepository } from "../src/modules/retention/retention.repository.ts";

describe("retention repository", () => {
  it("deletes only old sessionless unverified users and preserves the object outbox", async () => {
    const operations: string[] = [];
    let candidateWhere: unknown;
    let guardedDeleteWhere: unknown;
    let queuedDeletion: unknown;
    let authEmailFindCount = 0;
    let expiredAuthEmailFind: unknown;
    let expiredAuthEmailUpdate: unknown;
    const uploadExpiresAt = new Date("2030-01-01T00:00:00.000Z");
    const transaction = {
      async $queryRaw() {
        operations.push("lock");
        return [{ acquired: true }];
      },
      session: createDeleteModel("session", operations, 2),
      user: {
        async findMany(input: { where: unknown }) {
          operations.push("user:findCandidates");
          candidateWhere = input.where;
          return [{ id: "unverified-user" }];
        },
        async deleteMany(input: { where: unknown }) {
          operations.push("user:delete");
          guardedDeleteWhere = input.where;
          return { count: 1 };
        },
      },
      storedAsset: {
        async findMany() {
          operations.push("storedAsset:find");
          return [{ objectKey: "assets/unverified-user/file", uploadExpiresAt }];
        },
        async deleteMany() {
          operations.push("storedAsset:delete");
          return { count: 1 };
        },
      },
      objectDeletionJob: {
        async createMany(input: unknown) {
          operations.push("objectDeletionJob:createMany");
          queuedDeletion = input;
          return { count: 1 };
        },
      },
      messageAttachment: createDeleteModel("messageAttachment", operations),
      projectDocument: {
        async updateMany() {
          operations.push("projectDocument:update");
          return { count: 1 };
        },
      },
      aiUsageLog: createDeleteModel("aiUsageLog", operations),
      authEmailJob: {
        async findMany(input: unknown) {
          authEmailFindCount += 1;
          operations.push(`authEmailJob:findCandidates:${authEmailFindCount}`);
          if (authEmailFindCount === 1) expiredAuthEmailFind = input;
          const count = authEmailFindCount === 1 ? 2 : 5;
          return Array.from({ length: count }, (_, index) => ({
            id: `auth-email-${authEmailFindCount}-${index}`,
          }));
        },
        async updateMany(input: unknown) {
          operations.push("authEmailJob:cancelExpired");
          expiredAuthEmailUpdate = input;
          return { count: 2 };
        },
        async deleteMany() {
          operations.push("authEmailJob:deleteTerminal");
          return { count: 5 };
        },
      },
      usageEvent: createDeleteModel("usageEvent", operations),
      passwordResetToken: createDeleteModel("passwordResetToken", operations, 3),
      emailVerificationToken: createDeleteModel("emailVerificationToken", operations, 4),
    };
    let transactionOptions: unknown;
    const database = {
      async $transaction(
        callback: (tx: typeof transaction) => Promise<unknown>,
        options: unknown
      ) {
        transactionOptions = options;
        return callback(transaction);
      },
    } as unknown as typeof prisma;
    const now = new Date("2026-08-12T12:00:00.000Z");
    const unverifiedAccountsBefore = new Date("2026-08-05T12:00:00.000Z");

    const result = await createPrismaRetentionRepository(database).purgeExpiredData(
      now,
      {
        authTokensBefore: new Date("2026-08-05T12:00:00.000Z"),
        unverifiedAccountsBefore,
        usageBefore: new Date("2026-07-11T12:00:00.000Z"),
      },
      25
    );

    assert.deepEqual(candidateWhere, {
      createdAt: { lte: unverifiedAccountsBefore },
      emailVerifiedAt: null,
      sessions: { none: {} },
    });
    assert.deepEqual(guardedDeleteWhere, {
      AND: [
        { id: "unverified-user" },
        {
          createdAt: { lte: unverifiedAccountsBefore },
          emailVerifiedAt: null,
          sessions: { none: {} },
        },
      ],
    });
    assert.deepEqual(queuedDeletion, {
      data: [{
        nextAttemptAt: new Date("2030-01-01T00:05:00.000Z"),
        objectKey: "assets/unverified-user/file",
      }],
      skipDuplicates: true,
    });
    assert.deepEqual(expiredAuthEmailFind, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: 25,
      where: {
        expiresAt: { lte: now },
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    assert.deepEqual(expiredAuthEmailUpdate, {
      data: {
        encryptedPayload: null,
        lockedAt: null,
        status: "CANCELLED",
      },
      where: {
        expiresAt: { lte: now },
        id: { in: ["auth-email-1-0", "auth-email-1-1"] },
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    assert.equal(
      operations.indexOf("objectDeletionJob:createMany") < operations.indexOf("storedAsset:delete"),
      true
    );
    assert.equal(operations.indexOf("storedAsset:delete") < operations.indexOf("user:delete"), true);
    assert.deepEqual(result, {
      aiUsageLogs: 1,
      authEmailJobs: 5,
      expiredAuthEmailJobsCancelled: 2,
      emailVerificationTokens: 4,
      lockAcquired: true,
      mayHaveMore: false,
      passwordResetTokens: 3,
      sessions: 2,
      unverifiedAccounts: 1,
      usageEvents: 1,
    });
    assert.deepEqual(transactionOptions, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 60_000,
    });
  });

  it("fails closed when the final eligibility guard no longer matches", async () => {
    const transaction = createRaceTransaction();
    const database = {
      async $transaction(callback: (tx: typeof transaction) => Promise<unknown>) {
        return callback(transaction);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () =>
        createPrismaRetentionRepository(database).purgeExpiredData(
          new Date("2026-08-12T12:00:00.000Z"),
          {
            authTokensBefore: new Date("2026-08-05T12:00:00.000Z"),
            unverifiedAccountsBefore: new Date("2026-08-05T12:00:00.000Z"),
            usageBefore: new Date("2026-07-11T12:00:00.000Z"),
          },
          25
        ),
      /became ineligible/
    );
  });

  it("skips immediately when another retention run owns the advisory lock", async () => {
    let touchedData = false;
    const transaction = {
      async $queryRaw() { return [{ acquired: false }]; },
      session: {
        async findMany() { touchedData = true; return []; },
      },
    };
    const database = {
      async $transaction(callback: (tx: typeof transaction) => Promise<unknown>) {
        return callback(transaction);
      },
    } as unknown as typeof prisma;

    const result = await createPrismaRetentionRepository(database).purgeExpiredData(
      new Date("2026-08-12T12:00:00.000Z"),
      {
        authTokensBefore: new Date("2026-08-05T12:00:00.000Z"),
        unverifiedAccountsBefore: new Date("2026-08-05T12:00:00.000Z"),
        usageBefore: new Date("2026-07-11T12:00:00.000Z"),
      },
      25
    );

    assert.equal(touchedData, false);
    assert.deepEqual(result, {
      aiUsageLogs: 0,
      authEmailJobs: 0,
      expiredAuthEmailJobsCancelled: 0,
      emailVerificationTokens: 0,
      lockAcquired: false,
      mayHaveMore: false,
      passwordResetTokens: 0,
      sessions: 0,
      unverifiedAccounts: 0,
      usageEvents: 0,
    });
  });
});

function createDeleteModel(name: string, operations: string[], count = 1) {
  return {
    async findMany() {
      operations.push(`${name}:findCandidates`);
      return Array.from({ length: count }, (_, index) => ({ id: `${name}-${index}` }));
    },
    async deleteMany() {
      operations.push(`${name}:delete`);
      return { count };
    },
  };
}

function createRaceTransaction() {
  return {
    async $queryRaw() {
      return [{ acquired: true }];
    },
    session: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    user: {
      async findMany() { return [{ id: "raced-user" }]; },
      async deleteMany() { return { count: 0 }; },
    },
    storedAsset: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    objectDeletionJob: { async createMany() { return { count: 0 }; } },
    messageAttachment: { async deleteMany() { return { count: 0 }; } },
    projectDocument: { async updateMany() { return { count: 0 }; } },
    aiUsageLog: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    authEmailJob: {
      async findMany() { return []; },
      async updateMany() { return { count: 0 }; },
      async deleteMany() { return { count: 0 }; },
    },
    usageEvent: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    passwordResetToken: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
    emailVerificationToken: {
      async findMany() { return []; },
      async deleteMany() { return { count: 0 }; },
    },
  };
}
