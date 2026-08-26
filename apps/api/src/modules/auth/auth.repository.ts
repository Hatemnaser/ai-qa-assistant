import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { AuthRepository } from "./auth.types.js";

export function createPrismaAuthRepository(database: typeof prisma = prisma): AuthRepository {
  return {
    async createPasswordUser(input) {
      return database.user.create({
        data: {
          acceptedTermsAt: input.acceptedTermsAt,
          acceptedTermsVersion: input.acceptedTermsVersion,
          email: input.email,
          locale: input.locale,
          name: input.name || null,
          passwordHash: input.passwordHash,
          settings: {
            create: {
              language: input.locale,
            },
          },
        },
      });
    },

    async createEmailVerificationToken(input) {
      await database.$transaction(async (tx) => {
        await lockAuthTokenState(tx, input.userId);

        await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            userId: input.userId,
            usedAt: null,
          },
        });

        await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
            kind: "EMAIL_VERIFICATION",
            status: {
              in: ["PENDING", "PROCESSING"],
            },
            userId: input.userId,
          },
        });

        const token = await tx.emailVerificationToken.create({
          data: {
            expiresAt: input.expiresAt,
            tokenHash: input.tokenHash,
            userId: input.userId,
          },
        });

        if (input.emailJob) {
          await tx.authEmailJob.create({
            data: {
              emailVerificationTokenId: token.id,
              encryptedPayload: input.emailJob.encryptedPayload,
              expiresAt: input.expiresAt,
              id: input.emailJob.id,
              kind: "EMAIL_VERIFICATION",
              userId: input.userId,
            },
          });
        }
      });
    },

    async createPasswordResetToken(input) {
      await database.$transaction(async (tx) => {
        await lockAuthTokenState(tx, input.userId);

        await tx.passwordResetToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            userId: input.userId,
            usedAt: null,
          },
        });

        await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
            kind: "PASSWORD_RESET",
            status: {
              in: ["PENDING", "PROCESSING"],
            },
            userId: input.userId,
          },
        });

        const token = await tx.passwordResetToken.create({
          data: {
            expiresAt: input.expiresAt,
            tokenHash: input.tokenHash,
            userId: input.userId,
          },
        });

        if (input.emailJob) {
          await tx.authEmailJob.create({
            data: {
              encryptedPayload: input.emailJob.encryptedPayload,
              expiresAt: input.expiresAt,
              id: input.emailJob.id,
              kind: "PASSWORD_RESET",
              passwordResetTokenId: token.id,
              userId: input.userId,
            },
          });
        }
      });
    },

    async createSession(input) {
      await database.session.create({
        data: {
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          tokenHash: input.tokenHash,
          userAgent: input.userAgent,
          userId: input.userId,
        },
      });
    },

    async deleteSessionByTokenHash(tokenHash) {
      await database.session.deleteMany({
        where: {
          tokenHash,
        },
      });
    },

    async findSessionByTokenHash(tokenHash) {
      return database.session.findUnique({
        include: {
          user: true,
        },
        where: {
          tokenHash,
        },
      });
    },

    async findUserByEmail(email) {
      return database.user.findUnique({
        where: {
          email,
        },
      });
    },

    async resetPasswordWithToken(input) {
      return database.$transaction(async (tx) => {
        const resetToken = await tx.passwordResetToken.findUnique({
          select: {
            expiresAt: true,
            id: true,
            usedAt: true,
            userId: true,
          },
          where: {
            tokenHash: input.tokenHash,
          },
        });

        if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= input.now) {
          return false;
        }

        await lockAuthTokenState(tx, resetToken.userId);

        const consumed = await tx.passwordResetToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            expiresAt: {
              gt: input.now,
            },
            id: resetToken.id,
            usedAt: null,
          },
        });

        if (consumed.count !== 1) {
          return false;
        }

        await tx.user.update({
          data: {
            passwordHash: input.newPasswordHash,
          },
          where: {
            id: resetToken.userId,
          },
        });

        // A successful password change invalidates every other reset link,
        // including any link created by a formerly concurrent request.
        await tx.passwordResetToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            userId: resetToken.userId,
            usedAt: null,
          },
        });

        await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
            kind: "PASSWORD_RESET",
            status: {
              in: ["PENDING", "PROCESSING"],
            },
            userId: resetToken.userId,
          },
        });

        await tx.session.deleteMany({
          where: {
            userId: resetToken.userId,
          },
        });

        return true;
      });
    },

    async verifyEmailWithToken(input) {
      return database.$transaction(async (tx) => {
        const verificationToken = await tx.emailVerificationToken.findUnique({
          select: {
            expiresAt: true,
            id: true,
            usedAt: true,
            user: {
              select: {
                emailVerifiedAt: true,
              },
            },
            userId: true,
          },
          where: {
            tokenHash: input.tokenHash,
          },
        });

        if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt <= input.now) {
          return false;
        }

        await lockAuthTokenState(tx, verificationToken.userId);

        const consumed = await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            expiresAt: {
              gt: input.now,
            },
            id: verificationToken.id,
            usedAt: null,
          },
        });

        if (consumed.count !== 1) {
          return false;
        }

        if (!verificationToken.user.emailVerifiedAt) {
          await tx.user.update({
            data: {
              emailVerifiedAt: input.now,
            },
            where: {
              id: verificationToken.userId,
            },
          });
        }

        await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            id: {
              not: verificationToken.id,
            },
            userId: verificationToken.userId,
            usedAt: null,
          },
        });

        await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
            kind: "EMAIL_VERIFICATION",
            status: {
              in: ["PENDING", "PROCESSING"],
            },
            userId: verificationToken.userId,
          },
        });

        return true;
      });
    },
  };
}

export const authRepository = createPrismaAuthRepository();

async function lockAuthTokenState(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`oddpath:auth-token-state:${userId}`}, 0)
    )
  `;
}
