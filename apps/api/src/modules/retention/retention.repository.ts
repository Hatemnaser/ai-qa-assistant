import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { AI_USAGE_ACTIONS } from "../usage/usage.types.js";
import { getUsageWindowStart } from "../usage/usage.scope.js";
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
            usageEvents:{none:{OR:[{settlementReceipts:{some:{appliedAt:null}}},{expiresAt:{not:null},status:{in:['reserved','settlement_pending','partial','unknown']}}]}},
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
        const settledUsageWhere:Prisma.UsageEventWhereInput={
          AND:[{OR:[{anonymousUntil:{lte:now}},
            {anonymousUntil:null,createdAt:{lte:cutoffs.usageBefore},
              settlementReceipts:{none:{appliedAt:null}},
              OR:[{expiresAt:null},{status:{notIn:['reserved','settlement_pending','partial','unknown']}}]}]},
            {NOT:activeQuotaUsageWhere(now)}],
        };
        const usageEventCandidates = await tx.usageEvent.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: batchSize,
          where: settledUsageWhere,
        });
        const usageEvents = await tx.usageEvent.deleteMany({
          where: { ...settledUsageWhere,id: { in: usageEventCandidates.map(({ id }) => id) } },
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

/** Retention age never grants headroom inside a still-active quota window. */
function activeQuotaUsageWhere(now:Date):Prisma.UsageEventWhereInput {
  const since=new Date(Math.min(
    now.getTime()-env.aiGlobalUsageWindowMs,
    now.getTime()-86_400_000,
    Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)
  ));
  const identitySince=getUsageWindowStart(now);
  return {action:{in:[...AI_USAGE_ACTIONS]},OR:[
    {createdAt:{gte:since}},
    // Fallback/lock waits can place an attempt later than its parent event.
    {attempts:{some:{startedAt:{gte:since}}}},
    // User, guest and IP quotas share the configured identity window. Deleted
    // accounts have no remaining identity, so this must not extend their term.
    {AND:[
      {OR:[{userId:{not:null}},{guestId:{not:null}},{ipHash:{not:null}}]},
      {OR:[{createdAt:{gte:identitySince}},{attempts:{some:{startedAt:{gte:identitySince}}}}]},
    ]},
    {status:'reserved',expiresAt:{gt:now},reservationPolicy:{not:Prisma.DbNull}},
  ]};
}

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
