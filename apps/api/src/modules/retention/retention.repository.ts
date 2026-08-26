import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  accountDataDeletionCoordinator,
  type AccountDataDeletionCoordinator,
} from "../account/account-data-deletion.js";
import type { RetentionPurgeResult, RetentionRepository } from "./retention.types.js";

export const RETENTION_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
});

export function createPrismaRetentionRepository(
  database: typeof prisma = prisma,
  dataDeletion: AccountDataDeletionCoordinator = accountDataDeletionCoordinator
): RetentionRepository {
  return {
    async purgeExpiredData(now, cutoffs, batchSize) {
      return database.$transaction(async (tx) => {
        // Never make a second cron/manual run wait behind an active cleanup.
        // A transaction-scoped try-lock also releases automatically on every
        // success/error path, so a crashed worker cannot strand the lock.
        const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(628150724111746) AS acquired
        `;
        if (!lockRows[0]?.acquired) return emptyPurgeResult(false);

        const sessionCandidates = await tx.session.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: batchSize,
          where: { expiresAt: { lte: now } },
        });
        const sessions = await tx.session.deleteMany({
          where: { id: { in: sessionCandidates.map(({ id }) => id) } },
        });
        const unverifiedCandidates = await tx.user.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: batchSize,
          where: {
            createdAt: { lte: cutoffs.unverifiedAccountsBefore },
            emailVerifiedAt: null,
            sessions: { none: {} },
          },
        });
        let unverifiedAccounts = 0;

        for (const candidate of unverifiedCandidates) {
          const deleted = await dataDeletion.deleteInTransaction(tx, candidate.id, {
            createdAtOnOrBefore: cutoffs.unverifiedAccountsBefore,
            kind: "unverified-sessionless",
          });

          if (deleted.count !== 1) {
            // A concurrent verification/session change must roll back every
            // preceding graph/object-outbox mutation for this cleanup run.
            throw new Error("Unverified account became ineligible during retention cleanup.");
          }

          unverifiedAccounts += 1;
        }
        const expiredAuthEmailJobCandidates = await tx.authEmailJob.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: batchSize,
          where: {
            expiresAt: { lte: now },
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
        const expiredAuthEmailJobsCancelled = await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
            expiresAt: { lte: now },
            id: { in: expiredAuthEmailJobCandidates.map(({ id }) => id) },
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
        const authEmailJobCandidates = await tx.authEmailJob.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: batchSize,
          where: {
            status: { in: ["SENT", "FAILED", "CANCELLED"] },
            updatedAt: { lte: cutoffs.authTokensBefore },
          },
        });
        const authEmailJobs = await tx.authEmailJob.deleteMany({
          where: { id: { in: authEmailJobCandidates.map(({ id }) => id) } },
        });
        const passwordResetTokenCandidates = await tx.passwordResetToken.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: batchSize,
          where: {
            OR: [
              { expiresAt: { lte: cutoffs.authTokensBefore } },
              { usedAt: { lte: cutoffs.authTokensBefore } },
            ],
          },
        });
        const passwordResetTokens = await tx.passwordResetToken.deleteMany({
          where: { id: { in: passwordResetTokenCandidates.map(({ id }) => id) } },
        });
        const emailVerificationTokenCandidates = await tx.emailVerificationToken.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: batchSize,
          where: {
            OR: [
              { expiresAt: { lte: cutoffs.authTokensBefore } },
              { usedAt: { lte: cutoffs.authTokensBefore } },
            ],
          },
        });
        const emailVerificationTokens = await tx.emailVerificationToken.deleteMany({
          where: { id: { in: emailVerificationTokenCandidates.map(({ id }) => id) } },
        });
        const usageEventCandidates = await tx.usageEvent.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: batchSize,
          where: { createdAt: { lte: cutoffs.usageBefore } },
        });
        const usageEvents = await tx.usageEvent.deleteMany({
          where: { id: { in: usageEventCandidates.map(({ id }) => id) } },
        });
        const aiUsageLogCandidates = await tx.aiUsageLog.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: batchSize,
          where: { createdAt: { lte: cutoffs.usageBefore } },
        });
        const aiUsageLogs = await tx.aiUsageLog.deleteMany({
          where: { id: { in: aiUsageLogCandidates.map(({ id }) => id) } },
        });

        return {
          aiUsageLogs: aiUsageLogs.count,
          authEmailJobs: authEmailJobs.count,
          expiredAuthEmailJobsCancelled: expiredAuthEmailJobsCancelled.count,
          emailVerificationTokens: emailVerificationTokens.count,
          lockAcquired: true,
          mayHaveMore: [
            aiUsageLogCandidates,
            authEmailJobCandidates,
            expiredAuthEmailJobCandidates,
            emailVerificationTokenCandidates,
            passwordResetTokenCandidates,
            sessionCandidates,
            unverifiedCandidates,
            usageEventCandidates,
          ].some((candidates) => candidates.length === batchSize),
          passwordResetTokens: passwordResetTokens.count,
          sessions: sessions.count,
          unverifiedAccounts,
          usageEvents: usageEvents.count,
        };
      }, RETENTION_TRANSACTION_OPTIONS);
    },
  };
}

export const retentionRepository = createPrismaRetentionRepository();

function emptyPurgeResult(lockAcquired: boolean): RetentionPurgeResult {
  return {
    aiUsageLogs: 0,
    authEmailJobs: 0,
    expiredAuthEmailJobsCancelled: 0,
    emailVerificationTokens: 0,
    lockAcquired,
    mayHaveMore: false,
    passwordResetTokens: 0,
    sessions: 0,
    unverifiedAccounts: 0,
    usageEvents: 0,
  };
}
