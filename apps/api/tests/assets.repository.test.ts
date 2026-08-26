import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaAssetsRepository } from "../src/modules/assets/assets.repository.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const LEASE_UNTIL = new Date("2026-08-12T12:15:00.000Z");
const CHECKSUM = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";

describe("assets repository", () => {
  it("serializes quota reservations per user and counts every undeleted asset", async () => {
    const calls: Record<string, unknown> = {};
    const created = createStoredAsset();
    const tx = {
      async $executeRaw(_parts: TemplateStringsArray, ownerId: string) {
        calls.lockOwnerId = ownerId;
        return 1;
      },
      storedAsset: {
        async aggregate(input: unknown) {
          calls.aggregate = input;
          return { _sum: { expectedSizeBytes: 512 } };
        },
        async count(input: unknown) {
          calls.count = input;
          return 1;
        },
        async create(input: unknown) {
          calls.create = input;
          return created;
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>, options: unknown) {
        calls.transactionOptions = options;
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const result = await createPrismaAssetsRepository(database).createPendingAssetReservation(
      createReservation()
    );

    assert.equal(result.id, "asset-1");
    assert.equal(calls.lockOwnerId, "user-1");
    assert.deepEqual(calls.transactionOptions, { isolationLevel: "Serializable" });
    assert.deepEqual(calls.count, {
      where: { ownerId: "user-1", status: { in: ["PENDING", "VALIDATING"] } },
    });
    assert.deepEqual(calls.aggregate, {
      _sum: { expectedSizeBytes: true },
      where: { ownerId: "user-1" },
    });
    assert.deepEqual((calls.create as { data: Record<string, unknown> }).data, {
      checksumSha256: CHECKSUM,
      declaredMimeType: "text/plain",
      expectedSizeBytes: 128,
      objectKey: "project-documents/2026/08/12/random",
      originalName: "notes.txt",
      ownerId: "user-1",
      projectId: "project-1",
      purpose: "PROJECT_DOCUMENT_SOURCE",
      uploadExpiresAt: new Date("2026-08-12T12:10:00.000Z"),
    });
  });

  it("rejects at the atomic pending limit before creating a row", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      storedAsset: {
        async aggregate() { return { _sum: { expectedSizeBytes: 0 } }; },
        async count() { return 4; },
        async create() { created = true; return createStoredAsset(); },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaAssetsRepository(database).createPendingAssetReservation(createReservation()),
      (error: unknown) => hasCode(error, "ASSET_PENDING_LIMIT_REACHED")
    );
    assert.equal(created, false);
  });

  it("retries a serialization conflict without widening the quota transaction", async () => {
    let attempts = 0;
    const tx = {
      async $executeRaw() { return 1; },
      storedAsset: {
        async aggregate() { return { _sum: { expectedSizeBytes: 0 } }; },
        async count() { return 0; },
        async create() { return createStoredAsset(); },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("serialization"), { code: "P2034" });
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await createPrismaAssetsRepository(database).createPendingAssetReservation(createReservation());
    assert.equal(attempts, 2);
  });

  it("claims PENDING to VALIDATING once and only before upload expiry", async () => {
    let claimWhere: unknown;
    const database = {
      storedAsset: {
        async updateMany(input: { where: unknown }) {
          claimWhere = input.where;
          return { count: 1 };
        },
        async findFirst() { return createStoredAsset({ status: "VALIDATING" }); },
      },
    } as unknown as typeof prisma;

    const claimed = await createPrismaAssetsRepository(database)
      .claimPendingAssetForValidation("user-1", "asset-1", NOW);

    assert.equal(claimed?.status, "VALIDATING");
    assert.deepEqual(claimWhere, {
      id: "asset-1",
      ownerId: "user-1",
      status: "PENDING",
      uploadExpiresAt: { gt: NOW },
    });
  });

  it("uses one database cleanup lease and recovers stale validation claims", async () => {
    const calls: Record<string, unknown> = {};
    let rawQueryCount = 0;
    const leaseUntil = new Date("2026-08-12T12:15:00.000Z");
    const tx = {
      async $queryRaw(query: unknown) {
        rawQueryCount += 1;
        if (rawQueryCount === 1) {
          calls.locked = true;
          return [{ acquired: true }];
        }
        calls.eligibleJobsQuery = query;
        return [{ attempts: 0, id: "job-1", objectKey: "project-documents/2026/08/12/random" }];
      },
      objectDeletionJob: {
        async count(input?: unknown) {
          if (input) {
            calls.dueBacklogQuery = input;
            return 2;
          }
          return 7;
        },
        async updateMany(input: unknown) { calls.jobLease = input; return { count: 1 }; },
        async createMany() { return { count: 0 }; },
      },
      storedAsset: {
        async findMany(input: unknown) { calls.candidatesQuery = input; return []; },
        async updateMany() { return { count: 0 }; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>, options: unknown) {
        calls.transactionOptions = options;
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const claimed = await createPrismaAssetsRepository(database).claimCleanupBatch(NOW, leaseUntil, 25);

    assert.equal(calls.locked, true);
    assert.equal(rawQueryCount, 2);
    assert.deepEqual(calls.transactionOptions, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000,
    });
    assert.deepEqual(claimed.jobs.map((job) => job.id), ["job-1"]);
    assert.equal(claimed.jobs[0]?.leaseUntil.toISOString(), leaseUntil.toISOString());
    assert.equal(claimed.lockAcquired, true);
    assert.equal(claimed.deletionBacklog, 7);
    assert.equal(claimed.dueDeletionBacklog, 2);
    const candidateWhere = (calls.candidatesQuery as { where: { OR: unknown[] } }).where;
    assert.deepEqual(candidateWhere.OR[1], {
      status: "VALIDATING",
      validationStartedAt: { lte: new Date("2026-08-12T11:45:00.000Z") },
    });
    const eligibleJobSql = (
      calls.eligibleJobsQuery as { strings?: string[] }
    ).strings?.join(" ") || "";
    assert.match(eligibleJobSql, /DELETE_PENDING/);
    assert.match(eligibleJobSql, /LEFT JOIN "StoredAsset"/);
    assert.match(eligibleJobSql, /asset\."id" IS NULL/);
    assert.match(eligibleJobSql, /MessageAttachment/);
    assert.match(eligibleJobSql, /ProjectDocument/);
    assert.deepEqual(calls.jobLease, {
      data: { nextAttemptAt: leaseUntil },
      where: { id: { in: ["job-1"] }, nextAttemptAt: { lte: NOW } },
    });
  });

  it("skips an overlapping cleanup without querying or leasing work", async () => {
    let queriedWork = false;
    const tx = {
      async $queryRaw() { return [{ acquired: false }]; },
      objectDeletionJob: {
        async findMany() { queriedWork = true; return []; },
      },
      storedAsset: {
        async findMany() { queriedWork = true; return []; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const claimed = await createPrismaAssetsRepository(database).claimCleanupBatch(
      NOW,
      new Date("2026-08-12T12:05:00.000Z"),
      25
    );

    assert.equal(queriedWork, false);
    assert.deepEqual(claimed, {
      cleanupCandidatesMayRemain: false,
      cleanupQueued: 0,
      deletionBacklog: null,
      dueDeletionBacklog: null,
      jobs: [],
      lockAcquired: false,
    });
  });

  it("rolls back the claim when the selected jobs are not leased exactly once", async () => {
    let rawQueryCount = 0;
    const tx = {
      async $queryRaw() {
        rawQueryCount += 1;
        return rawQueryCount === 1
          ? [{ acquired: true }]
          : [{ attempts: 0, id: "job-1", objectKey: "detached/object" }];
      },
      objectDeletionJob: {
        async updateMany() { return { count: 0 }; },
      },
      storedAsset: {
        async findMany() { return []; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaAssetsRepository(database).claimCleanupBatch(
        NOW,
        LEASE_UNTIL,
        25
      ),
      /could not be leased exactly once/
    );
  });

  it("removes unreferenced DELETE_PENDING metadata before completing its job", async () => {
    const operations: string[] = [];
    const tx = {
      objectDeletionJob: {
        async deleteMany() { operations.push("job"); return { count: 1 }; },
        async updateMany(input: unknown) {
          operations.push("job:claim");
          assert.deepEqual(input, {
            data: { nextAttemptAt: LEASE_UNTIL },
            where: {
              id: "job-1",
              nextAttemptAt: LEASE_UNTIL,
              objectKey: "chat-attachments/2026/08/12/random",
            },
          });
          return { count: 1 };
        },
      },
      storedAsset: {
        async findUnique() { operations.push("asset:verify"); return { id: "asset-1" }; },
        async deleteMany(input: unknown) {
          operations.push("asset");
          assert.deepEqual(input, {
            where: {
              id: "asset-1",
              objectKey: "chat-attachments/2026/08/12/random",
              messageAttachment: null,
              sourceDocument: null,
              status: "DELETE_PENDING",
            },
          });
          return { count: 1 };
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaAssetsRepository(database).removeDeletedObject(
        "job-1",
        "chat-attachments/2026/08/12/random",
        LEASE_UNTIL
      ),
      true
    );
    assert.deepEqual(operations, ["job:claim", "asset:verify", "asset", "job"]);
  });

  it("purges a failed restore session after its last staged asset is removed", async () => {
    let sessionDelete: unknown;
    const tx = {
      binaryAssetRestoreSession: {
        async deleteMany(input: unknown) {
          sessionDelete = input;
          return { count: 1 };
        },
      },
      objectDeletionJob: {
        async deleteMany() { return { count: 1 }; },
        async updateMany() { return { count: 1 }; },
      },
      storedAsset: {
        async deleteMany() { return { count: 1 }; },
        async findUnique() {
          return {
            id: "asset-1",
            restoreAttempt: 1,
            restoreSessionId: "restore-session-1",
          };
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaAssetsRepository(database).removeDeletedObject(
        "job-1",
        "chat-attachments/restore-1",
        LEASE_UNTIL
      ),
      true
    );
    assert.deepEqual(sessionDelete, {
      where: {
        assets: { none: {} },
        attempt: 1,
        id: "restore-session-1",
      },
    });
  });

  it("completes a detached account-deletion outbox job after its object is gone", async () => {
    let deletedAssets = 0;
    let deletedJobs = 0;
    const tx = {
      objectDeletionJob: {
        async deleteMany() { deletedJobs += 1; return { count: 1 }; },
        async updateMany() { return { count: 1 }; },
      },
      storedAsset: {
        async deleteMany() { deletedAssets += 1; return { count: 0 }; },
        async findUnique() { return null; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaAssetsRepository(database).removeDeletedObject(
        "job-1",
        "account-deleted/object",
        LEASE_UNTIL
      ),
      true
    );

    assert.equal(deletedAssets, 0);
    assert.equal(deletedJobs, 1);
  });

  it("keeps the deletion job when its exact DELETE_PENDING asset cannot be removed", async () => {
    let deletedJobs = 0;
    const tx = {
      objectDeletionJob: {
        async deleteMany() { deletedJobs += 1; return { count: 1 }; },
        async updateMany() { return { count: 1 }; },
      },
      storedAsset: {
        async findUnique() { return { id: "asset-1" }; },
        async deleteMany() { return { count: 0 }; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaAssetsRepository(database)
        .removeDeletedObject(
          "job-1",
          "chat-attachments/2026/08/12/random",
          LEASE_UNTIL
        ),
      /no longer targets/
    );
    assert.equal(deletedJobs, 0);
  });

  it("does not remove metadata after a newer worker replaces the lease", async () => {
    let touchedAsset = false;
    const tx = {
      objectDeletionJob: {
        async updateMany() { return { count: 0 }; },
      },
      storedAsset: {
        async findUnique() { touchedAsset = true; return null; },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    assert.equal(
      await createPrismaAssetsRepository(database).removeDeletedObject(
        "job-1",
        "chat-attachments/2026/08/12/random",
        LEASE_UNTIL
      ),
      false
    );
    assert.equal(touchedAsset, false);
  });

  it("renews and reschedules deletion work only for the exact lease token", async () => {
    const updates: unknown[] = [];
    const database = {
      objectDeletionJob: {
        async updateMany(input: unknown) {
          updates.push(input);
          return { count: updates.length === 1 ? 1 : 0 };
        },
      },
    } as unknown as typeof prisma;
    const repository = createPrismaAssetsRepository(database);
    const renewedUntil = new Date("2026-08-12T12:20:00.000Z");
    const retryAt = new Date("2026-08-12T12:21:00.000Z");

    assert.equal(
      await repository.renewDeletionClaim(
        "job-1",
        "chat-attachments/2026/08/12/random",
        LEASE_UNTIL,
        renewedUntil
      ),
      true
    );
    assert.equal(
      await repository.recordDeletionFailure(
        "job-1",
        "chat-attachments/2026/08/12/random",
        renewedUntil,
        2,
        retryAt,
        "Error:Timeout"
      ),
      false
    );
    assert.deepEqual(updates, [
      {
        data: { nextAttemptAt: renewedUntil },
        where: {
          id: "job-1",
          nextAttemptAt: LEASE_UNTIL,
          objectKey: "chat-attachments/2026/08/12/random",
        },
      },
      {
        data: { attempts: 2, lastError: "Error:Timeout", nextAttemptAt: retryAt },
        where: {
          id: "job-1",
          nextAttemptAt: renewedUntil,
          objectKey: "chat-attachments/2026/08/12/random",
        },
      },
    ]);
  });
});

function createReservation() {
  return {
    checksumSha256: CHECKSUM,
    declaredMimeType: "text/plain",
    expectedSizeBytes: 128,
    maxPendingPerUser: 4,
    objectKey: "project-documents/2026/08/12/random",
    originalName: "notes.txt",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE" as const,
    uploadExpiresAt: new Date("2026-08-12T12:10:00.000Z"),
    userQuotaBytes: 1024,
  };
}

function createStoredAsset(overrides: Record<string, unknown> = {}) {
  return {
    checksumSha256: CHECKSUM,
    createdAt: NOW,
    declaredMimeType: "text/plain",
    detectedMimeType: null,
    etag: null,
    expectedSizeBytes: 128,
    id: "asset-1",
    objectKey: "project-documents/2026/08/12/random",
    originalName: "notes.txt",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE",
    readyAt: null,
    sizeBytes: null,
    status: "PENDING",
    updatedAt: NOW,
    uploadExpiresAt: new Date("2026-08-12T12:10:00.000Z"),
    validationStartedAt: null,
    ...overrides,
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
