import { env } from "../../config/env.js";
import { assetsRepository } from "./assets.repository.js";
import { assetStorage, type AssetStorage } from "./assets.storage.js";
import type { AssetsRepository } from "./assets.types.js";

const CLEANUP_LEASE_MS = 15 * 60 * 1000;

export interface AssetCleanupDependencies {
  batchSize?: number;
  now?: () => Date;
  repository: AssetsRepository;
  storage: AssetStorage;
}

export function createAssetCleanupWorker({
  batchSize = env.assetCleanupBatchSize,
  now = () => new Date(),
  repository,
  storage,
}: AssetCleanupDependencies) {
  async function runOnce() {
    const startedAt = now();
    const leaseUntil = new Date(startedAt.getTime() + CLEANUP_LEASE_MS);
    const claimed = await repository.claimCleanupBatch(startedAt, leaseUntil, batchSize);
    const jobs = claimed.jobs;
    let deleted = 0;
    let failed = 0;
    let leaseConflicts = 0;

    for (const job of jobs) {
      const processingLeaseUntil = new Date(now().getTime() + CLEANUP_LEASE_MS);
      const renewed = await repository.renewDeletionClaim(
        job.id,
        job.objectKey,
        job.leaseUntil,
        processingLeaseUntil
      );
      if (!renewed) {
        leaseConflicts += 1;
        continue;
      }

      try {
        // S3/R2 DELETE is idempotent: a missing object is success.
        await storage.deleteObject(job.objectKey);
        const completed = await repository.removeDeletedObject(
          job.id,
          job.objectKey,
          processingLeaseUntil
        );
        if (completed) {
          deleted += 1;
        } else {
          leaseConflicts += 1;
        }
      } catch (error) {
        const attempts = job.attempts + 1;
        const failureRecorded = await repository.recordDeletionFailure(
          job.id,
          job.objectKey,
          processingLeaseUntil,
          attempts,
          new Date(now().getTime() + backoffMilliseconds(attempts)),
          sanitizeWorkerError(error)
        );
        if (failureRecorded) {
          failed += 1;
        } else {
          leaseConflicts += 1;
        }
      }
    }

    return {
      cleanupCandidatesMayRemain: claimed.cleanupCandidatesMayRemain,
      cleanupQueued: claimed.cleanupQueued,
      deleted,
      deletionBacklog: claimed.deletionBacklog,
      dueDeletionBacklog: claimed.dueDeletionBacklog,
      failed,
      leaseConflicts,
      lockAcquired: claimed.lockAcquired,
      processed: jobs.length,
    };
  }

  return { runOnce };
}

export const assetCleanupWorker = createAssetCleanupWorker({
  repository: assetsRepository,
  storage: assetStorage,
});

export function assetCleanupResultRequiresAttention(result: {
  failed: number;
  leaseConflicts: number;
}) {
  return result.failed > 0 || result.leaseConflicts > 0;
}

export function getAssetCleanupRunStatus(result: {
  failed: number;
  leaseConflicts: number;
  lockAcquired: boolean;
}) {
  if (!result.lockAcquired) return "overlap_skipped" as const;
  return result.failed > 0 || result.leaseConflicts > 0
    ? "failed" as const
    : "completed" as const;
}

function backoffMilliseconds(attempts: number) {
  return Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 10));
}

function sanitizeWorkerError(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = readSafeCode(error);

  return `${name}:${code}`.slice(0, 160);
}

function readSafeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const code = (error as Record<string, unknown>).code;

  return typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : "UNKNOWN";
}
