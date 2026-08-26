import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logOperationalEvent } from "../lib/operational-events.js";
import {
  assetCleanupResultRequiresAttention,
  assetCleanupWorker,
  getAssetCleanupRunStatus,
} from "../modules/assets/assets.cleanup.js";
import { isAssetStorageConfigured } from "../modules/assets/assets.storage.js";

const startedAt = Date.now();

async function main() {
  if (!isAssetStorageConfigured(env)) {
    logOperationalEvent("info", {
      cleanupCandidatesMayRemain: false,
      cleanupQueued: 0,
      deleted: 0,
      deletionBacklog: null,
      dueDeletionBacklog: null,
      durationMs: Date.now() - startedAt,
      event: "asset_cleanup",
      failed: 0,
      leaseConflicts: 0,
      lockAcquired: false,
      processed: 0,
      status: "disabled_skipped",
    });
    return;
  }

  const result = await assetCleanupWorker.runOnce();
  const status = getAssetCleanupRunStatus(result);
  logOperationalEvent(
    status === "completed" ? "info" : "warn",
    {
      ...result,
      durationMs: Date.now() - startedAt,
      event: "asset_cleanup",
      status,
    }
  );

  if (assetCleanupResultRequiresAttention(result)) {
    process.exitCode = 1;
  }
}

main()
  .catch(() => {
    logOperationalEvent("error", {
      cleanupCandidatesMayRemain: true,
      cleanupQueued: 0,
      deleted: 0,
      deletionBacklog: null,
      dueDeletionBacklog: null,
      durationMs: Date.now() - startedAt,
      event: "asset_cleanup",
      failed: 0,
      leaseConflicts: 0,
      lockAcquired: false,
      processed: 0,
      status: "failed",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
