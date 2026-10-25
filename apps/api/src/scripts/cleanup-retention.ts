import "dotenv/config";

import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import {requireOperationalDatabase} from '../db/recovery-guard.js';
import { authAbuseRepository } from '../modules/auth/auth-abuse.repository.js';
import { logOperationalEvent } from "../lib/operational-events.js";
import { getRetentionCleanupOutcome } from "../modules/retention/retention.cleanup-outcome.js";
import {
  getConfiguredRetentionPolicy,
  retentionService,
} from "../modules/retention/retention.service.js";

const startedAt = Date.now();

async function main() {
  await requireOperationalDatabase();
  const policy = getConfiguredRetentionPolicy();
  const batchSize = env.retentionCleanupBatchSize;
  const result = await retentionService.drain(new Date(), policy, batchSize);
  const { batches, lockAcquired, mayHaveMore, stopReason, ...removed } = result;
  const outcome = getRetentionCleanupOutcome(result);

  logOperationalEvent(outcome.level, {
    batchSize,
    batches,
    durationMs: Date.now() - startedAt,
    event: "retention_cleanup",
    lockAcquired,
    mayHaveMore,
    removed,
    status: outcome.status,
    stopReason,
  });

  // A max-batch or no-progress stop means eligible rows remain. Surface that
  // to Render/cron instead of reporting a false success.
  if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  if (env.authAbuseStore==='postgres') {
    let removed=0,last=0;
    for (let batch=0;batch<20;batch++) {last=await authAbuseRepository.cleanup();removed+=last;if(last<100)break;}
    logOperationalEvent(last===100?'warn':'info',{event:'auth_abuse_cleanup',removed,mayHaveMore:last===100});
    if (last===100) process.exitCode=1;
  }
}

main()
  .catch(() => {
    logOperationalEvent("error", {
      batchSize: env.retentionCleanupBatchSize,
      batches: 0,
      durationMs: Date.now() - startedAt,
      event: "retention_cleanup",
      lockAcquired: false,
      mayHaveMore: true,
      removed: {
        aiUsageLogs: 0,
        authEmailJobs: 0,
        expiredAuthEmailJobsCancelled: 0,
        emailVerificationTokens: 0,
        passwordResetTokens: 0,
        sessions: 0,
        unverifiedAccounts: 0,
        usageEvents: 0,
      },
      status: "failed",
      stopReason: "error",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
