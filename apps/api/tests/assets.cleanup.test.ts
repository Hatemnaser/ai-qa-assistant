import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetCleanupResultRequiresAttention,
  createAssetCleanupWorker,
  getAssetCleanupRunStatus,
} from "../src/modules/assets/assets.cleanup.ts";
import type { AssetStorage } from "../src/modules/assets/assets.storage.ts";
import type { AssetsRepository } from "../src/modules/assets/assets.types.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const LEASE_UNTIL = new Date("2026-08-12T12:15:00.000Z");

describe("asset cleanup worker", () => {
  it("makes scheduler-visible object deletion failures actionable", () => {
    assert.equal(assetCleanupResultRequiresAttention({ failed: 0, leaseConflicts: 0 }), false);
    assert.equal(assetCleanupResultRequiresAttention({ failed: 1, leaseConflicts: 0 }), true);
    assert.equal(assetCleanupResultRequiresAttention({ failed: 0, leaseConflicts: 1 }), true);
    assert.equal(
      getAssetCleanupRunStatus({ failed: 0, leaseConflicts: 0, lockAcquired: true }),
      "completed"
    );
    assert.equal(
      getAssetCleanupRunStatus({ failed: 1, leaseConflicts: 0, lockAcquired: true }),
      "failed"
    );
    assert.equal(
      getAssetCleanupRunStatus({ failed: 0, leaseConflicts: 0, lockAcquired: false }),
      "overlap_skipped"
    );
  });

  it("queues stale assets and treats idempotent object deletion as success", async () => {
    const deleted: string[] = [];
    const removedJobs: string[] = [];
    const repository = createRepository({
      cleanupQueued: 1,
      jobs: [{ attempts: 0, id: "job-1", leaseUntil: LEASE_UNTIL, objectKey: "opaque/object-1" }],
      removeDeletedObject: async (jobId) => { removedJobs.push(jobId); return true; },
    });
    const worker = createAssetCleanupWorker({
      now: () => NOW,
      repository,
      storage: createStorage(async (objectKey) => { deleted.push(objectKey); }),
    });

    assert.deepEqual(await worker.runOnce(), {
      cleanupCandidatesMayRemain: false,
      cleanupQueued: 1,
      deleted: 1,
      deletionBacklog: 1,
      dueDeletionBacklog: 0,
      failed: 0,
      leaseConflicts: 0,
      lockAcquired: true,
      processed: 1,
    });
    assert.deepEqual(deleted, ["opaque/object-1"]);
    assert.deepEqual(removedJobs, ["job-1"]);
  });

  it("uses bounded exponential retry and stores no raw provider URL/message", async () => {
    const failures: unknown[] = [];
    const repository = createRepository({
      jobs: [{ attempts: 2, id: "job-1", leaseUntil: LEASE_UNTIL, objectKey: "opaque/object-1" }],
      recordDeletionFailure: async (...args) => { failures.push(args); return true; },
    });
    const worker = createAssetCleanupWorker({
      now: () => NOW,
      repository,
      storage: createStorage(async () => {
        throw Object.assign(new Error("https://secret.invalid/?signature=private"), { code: "Timeout" });
      }),
    });

    assert.deepEqual(await worker.runOnce(), {
      cleanupCandidatesMayRemain: false,
      cleanupQueued: 0,
      deleted: 0,
      deletionBacklog: 1,
      dueDeletionBacklog: 0,
      failed: 1,
      leaseConflicts: 0,
      lockAcquired: true,
      processed: 1,
    });
    const [jobId, objectKey, leaseUntil, attempts, nextAttemptAt, lastError] = failures[0] as [
      string,
      string,
      Date,
      number,
      Date,
      string,
    ];
    assert.equal(jobId, "job-1");
    assert.equal(objectKey, "opaque/object-1");
    assert.equal(leaseUntil.toISOString(), LEASE_UNTIL.toISOString());
    assert.equal(attempts, 3);
    assert.equal(nextAttemptAt.toISOString(), "2026-08-12T12:04:00.000Z");
    assert.equal(lastError, "Error:Timeout");
    assert.doesNotMatch(lastError, /secret|signature|https/i);
  });

  it("does not touch storage after another instance replaces the claim lease", async () => {
    let deleteCalls = 0;
    const repository = createRepository({
      jobs: [{ attempts: 0, id: "job-1", leaseUntil: LEASE_UNTIL, objectKey: "opaque/object-1" }],
      renewDeletionClaim: async () => false,
    });
    const worker = createAssetCleanupWorker({
      now: () => NOW,
      repository,
      storage: createStorage(async () => { deleteCalls += 1; }),
    });

    assert.deepEqual(await worker.runOnce(), {
      cleanupCandidatesMayRemain: false,
      cleanupQueued: 0,
      deleted: 0,
      deletionBacklog: 1,
      dueDeletionBacklog: 0,
      failed: 0,
      leaseConflicts: 1,
      lockAcquired: true,
      processed: 1,
    });
    assert.equal(deleteCalls, 0);
  });

  it("does not overwrite a newer lease when a slow failed deletion loses its claim", async () => {
    const repository = createRepository({
      jobs: [{ attempts: 0, id: "job-1", leaseUntil: LEASE_UNTIL, objectKey: "opaque/object-1" }],
      recordDeletionFailure: async () => false,
    });
    const worker = createAssetCleanupWorker({
      now: () => NOW,
      repository,
      storage: createStorage(async () => { throw new Error("timed out"); }),
    });

    const result = await worker.runOnce();
    assert.equal(result.failed, 0);
    assert.equal(result.leaseConflicts, 1);
  });
});

function createRepository(overrides: Partial<AssetsRepository> & {
  cleanupQueued?: number;
  jobs?: Array<{ attempts: number; id: string; leaseUntil: Date; objectKey: string }>;
}): AssetsRepository {
  return {
    async cancelPendingAsset() { return null; },
    async claimPendingAssetForValidation() { return null; },
    async completeValidatingAsset() { return null; },
    async createPendingAssetReservation() { throw new Error("not used"); },
    async enqueueAssetDeletion() { return null; },
    async failValidatingAsset() { return null; },
    async claimCleanupBatch() {
      return {
        cleanupCandidatesMayRemain: false,
        cleanupQueued: overrides.cleanupQueued || 0,
        deletionBacklog: 1,
        dueDeletionBacklog: 0,
        jobs: overrides.jobs || [],
        lockAcquired: true,
      };
    },
    async findOwnedAsset() { return null; },
    async markAssetFailed() {},
    async recordDeletionFailure(jobId, objectKey, leaseUntil, attempts, nextAttemptAt, lastError) {
      return (await overrides.recordDeletionFailure?.(
        jobId,
        objectKey,
        leaseUntil,
        attempts,
        nextAttemptAt,
        lastError
      )) ?? true;
    },
    async releaseValidationClaim() {},
    async removeDeletedObject(jobId, objectKey, leaseUntil) {
      return (await overrides.removeDeletedObject?.(jobId, objectKey, leaseUntil)) ?? true;
    },
    async renewDeletionClaim(jobId, objectKey, currentLeaseUntil, renewedLeaseUntil) {
      return (await overrides.renewDeletionClaim?.(
        jobId,
        objectKey,
        currentLeaseUntil,
        renewedLeaseUntil
      )) ?? true;
    },
  };
}

function createStorage(deleteObject: (objectKey: string) => Promise<void>): AssetStorage {
  return {
    async createDownloadUrl() { throw new Error("not used"); },
    async createUploadUrl() { throw new Error("not used"); },
    deleteObject,
    async inspectObject() { throw new Error("not used"); },
    async readObject() { throw new Error("not used"); },
    async readObjectSample() { throw new Error("not used"); },
    async writeObject() { throw new Error("not used"); },
  };
}
