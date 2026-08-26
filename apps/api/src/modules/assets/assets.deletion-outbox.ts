import type { Prisma } from "../../generated/prisma/client.js";
import { getAssetDeletionNotBefore } from "./assets.deletion.js";

export interface AssetDeletionReference {
  objectKey: string;
  uploadExpiresAt?: Date | null;
}

/**
 * Adds object deletion work to the durable outbox in the caller's database
 * transaction. Re-enqueueing the same object is intentionally idempotent and
 * never moves an existing job's retry schedule.
 */
export async function enqueueAssetDeletionJobs(
  tx: Prisma.TransactionClient,
  assets: readonly AssetDeletionReference[],
  now = new Date()
) {
  const uniqueAssets = new Map(assets.map((asset) => [asset.objectKey, asset]));

  if (uniqueAssets.size === 0) return;

  await tx.objectDeletionJob.createMany({
    data: [...uniqueAssets.values()].map((asset) => ({
      objectKey: asset.objectKey,
      nextAttemptAt: getAssetDeletionNotBefore(asset.uploadExpiresAt, now),
    })),
    // objectKey is unique. An existing job owns its retry schedule, so a
    // repeated enqueue must not move nextAttemptAt backwards or forwards.
    skipDuplicates: true,
  });
}
