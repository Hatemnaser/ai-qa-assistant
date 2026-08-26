import { prisma } from "../../db/prisma.js";
import type {
  AuthEmailOutboxRepository,
  ClaimNextAuthEmailJobInput,
} from "./auth-email-outbox.types.js";

export function createPrismaAuthEmailOutboxRepository(
  database: typeof prisma = prisma
): AuthEmailOutboxRepository {
  return {
    async cancelExpired(input) {
      return database.$transaction(async (tx) => {
        const candidates = await tx.authEmailJob.findMany({
          orderBy: { id: "asc" },
          select: { id: true },
          take: input.limit,
          where: {
            expiresAt: { lte: input.now },
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });

        if (candidates.length === 0) return 0;

        const cancelled = await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lastErrorCode: null,
            lockedAt: null,
            nextAttemptAt: input.now,
            status: "CANCELLED",
          },
          where: {
            expiresAt: { lte: input.now },
            id: { in: candidates.map(({ id }) => id) },
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });

        return cancelled.count;
      });
    },

    async claimNext(input) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = await database.authEmailJob.findFirst({
          orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
          select: { id: true },
          where: buildClaimableWhere(input),
        });

        if (!candidate) return null;

        const claimed = await database.authEmailJob.updateMany({
          data: {
            attempts: { increment: 1 },
            lastErrorCode: null,
            lockedAt: input.now,
            status: "PROCESSING",
          },
          where: {
            id: candidate.id,
            ...buildClaimableWhere(input),
          },
        });

        if (claimed.count !== 1) continue;

        const job = await database.authEmailJob.findUnique({
          include: {
            emailVerificationToken: {
              select: {
                expiresAt: true,
                usedAt: true,
              },
            },
            passwordResetToken: {
              select: {
                expiresAt: true,
                usedAt: true,
              },
            },
            user: {
              select: {
                email: true,
                emailVerifiedAt: true,
              },
            },
          },
          where: { id: candidate.id },
        });

        if (!job?.encryptedPayload || !job.lockedAt) continue;

        const token = job.kind === "EMAIL_VERIFICATION"
          ? job.emailVerificationToken
          : job.passwordResetToken;

        if (!token) {
          await this.markCancelled({
            attempts: job.attempts,
            id: candidate.id,
            lockedAt: job.lockedAt,
            now: input.now,
          });
          continue;
        }

        return {
          attempts: job.attempts,
          email: job.user.email,
          encryptedPayload: job.encryptedPayload,
          expiresAt: job.expiresAt,
          id: job.id,
          kind: job.kind,
          lockedAt: job.lockedAt,
          tokenExpiresAt: token.expiresAt,
          tokenUsedAt: token.usedAt,
          userEmailVerifiedAt: job.user.emailVerifiedAt,
          userId: job.userId,
        };
      }

      return null;
    },

    async countPending(now) {
      return database.authEmailJob.count({
        where: {
          expiresAt: { gt: now },
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });
    },

    async markCancelled(input) {
      const updated = await database.authEmailJob.updateMany({
        data: {
          encryptedPayload: null,
          lastErrorCode: null,
          lockedAt: null,
          nextAttemptAt: input.now,
          status: "CANCELLED",
        },
        where: {
          attempts: input.attempts,
          id: input.id,
          lockedAt: input.lockedAt,
          status: "PROCESSING",
        },
      });

      return updated.count === 1;
    },

    async markSent(input) {
      const updated = await database.authEmailJob.updateMany({
        data: {
          encryptedPayload: null,
          lastErrorCode: null,
          lockedAt: null,
          sentAt: input.now,
          status: "SENT",
        },
        where: {
          attempts: input.attempts,
          id: input.id,
          lockedAt: input.lockedAt,
          status: "PROCESSING",
        },
      });

      return updated.count === 1;
    },

    async markFailedOrRetry(input) {
      const shouldFail = input.attempts >= input.maxAttempts;
      const updated = await database.authEmailJob.updateMany({
        data: shouldFail
          ? {
              encryptedPayload: null,
              lastErrorCode: "SMTP_DELIVERY_FAILED",
              lockedAt: null,
              nextAttemptAt: input.now,
              status: "FAILED",
            }
          : {
              lastErrorCode: "SMTP_DELIVERY_FAILED",
              lockedAt: null,
              nextAttemptAt: input.nextAttemptAt,
              status: "PENDING",
            },
        where: {
          attempts: input.attempts,
          id: input.id,
          lockedAt: input.lockedAt,
          status: "PROCESSING",
        },
      });

      if (updated.count !== 1) return null;
      return shouldFail ? "failed" : "retry";
    },
  };
}

function buildClaimableWhere(input: ClaimNextAuthEmailJobInput) {
  return {
    expiresAt: { gt: input.now },
    OR: [
      {
        nextAttemptAt: { lte: input.now },
        status: "PENDING" as const,
      },
      {
        lockedAt: { lte: input.staleBefore },
        status: "PROCESSING" as const,
      },
    ],
  };
}

export const authEmailOutboxRepository = createPrismaAuthEmailOutboxRepository();
