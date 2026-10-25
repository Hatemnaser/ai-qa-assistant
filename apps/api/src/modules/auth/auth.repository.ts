import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from '../../lib/errors.js';
import type { AuthRepository } from "./auth.types.js";

export function createPrismaAuthRepository(database: typeof prisma = prisma, now:()=>Date=()=>new Date()): AuthRepository {
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
      return database.$transaction(async (tx) => {
        await lockAuthTokenState(tx, input.userId);
        const user = await lockAuthUser(tx, input.userId);
        if (!user || user.emailVerifiedAt || input.expiresAt <= now() ||
          (input.expectedPasswordHash !== undefined && user.passwordHash !== input.expectedPasswordHash)) return false;

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
        return true;
      });
    },

    async createPasswordResetToken(input) {
      return database.$transaction(async (tx) => {
        await lockAuthTokenState(tx, input.userId);
        const user = await lockAuthUser(tx, input.userId);
        if (!user || input.expiresAt <= now() ||
          (input.expectedPasswordHash !== undefined && user.passwordHash !== input.expectedPasswordHash)) return false;

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
        return true;
      });
    },

    async createSession(input) {
      const write = (tx:Prisma.TransactionClient)=>tx.session.create({
        data: {
          expiresAt: input.expiresAt,
          ipAddress: input.ipAddress,
          tokenHash: input.tokenHash,
          userAgent: input.userAgent,
          userId: input.userId,
        },
      });
      if (input.expectedPasswordHash === undefined) {await write(database);return;}
      await database.$transaction(async tx=>{
        // Reset and login share this fence: a password verified before reset
        // cannot create a new session after reset invalidated older sessions.
        await lockAuthTokenState(tx,input.userId);
        const credential=await tx.user.findFirst({where:{id:input.userId,passwordHash:input.expectedPasswordHash,emailVerifiedAt:{not:null}},select:{id:true}});
        if (!credential || input.expiresAt<=now()) throw new AppError('Invalid email or password.',401,'INVALID_CREDENTIALS');
        await write(tx);
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
        if (!await lockAuthUser(tx, resetToken.userId)) return false;
        await tx.$queryRaw`SELECT id FROM "PasswordResetToken" WHERE id=${resetToken.id} FOR UPDATE`;

        const decisionAt=new Date(Math.max(input.now.getTime(),now().getTime()));

        const consumed = await tx.passwordResetToken.updateMany({
          data: {
            usedAt: decisionAt,
          },
          where: {
            expiresAt: {
              gt: decisionAt,
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

        // A previously issued activation link must not replace this password.
        await tx.emailVerificationToken.updateMany({
          data: { usedAt: decisionAt },
          where: { userId: resetToken.userId, usedAt: null },
        });

        await tx.authEmailJob.updateMany({
          data: {
            encryptedPayload: null,
            lockedAt: null,
            status: "CANCELLED",
          },
          where: {
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
      // Also fail closed for trusted adapters which have not adopted the new
      // activation contract. Token-only activation must never survive a rollout.
      if (!input.newPasswordHash) return false;
      return database.$transaction(async (tx) => {
        const verificationToken = await tx.emailVerificationToken.findUnique({
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

        if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt <= input.now) {
          return false;
        }

        await lockAuthTokenState(tx, verificationToken.userId);
        const user = await lockAuthUser(tx, verificationToken.userId);
        if (!user || user.emailVerifiedAt) return false;
        await tx.$queryRaw`SELECT id FROM "EmailVerificationToken" WHERE id=${verificationToken.id} FOR UPDATE`;

        const decisionAt=new Date(Math.max(input.now.getTime(),now().getTime()));

        const consumed = await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: decisionAt,
          },
          where: {
            expiresAt: {
              gt: decisionAt,
            },
            id: verificationToken.id,
            usedAt: null,
          },
        });

        if (consumed.count !== 1) {
          return false;
        }

        // Ownership and the owner-selected credential become effective in the
        // same transaction. No pre-registration password is ever activated.
        await tx.user.update({
          data: { emailVerifiedAt: decisionAt, passwordHash: input.newPasswordHash },
          where: { id: verificationToken.userId },
        });
        await tx.session.deleteMany({ where: { userId: verificationToken.userId } });
        await tx.passwordResetToken.updateMany({
          data: { usedAt: decisionAt },
          where: { userId: verificationToken.userId, usedAt: null },
        });

        await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: decisionAt,
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

async function lockAuthUser(tx: Prisma.TransactionClient, userId: string) {
  const [user] = await tx.$queryRaw<Array<{ passwordHash: string | null; emailVerifiedAt: Date | null }>>`
    SELECT "passwordHash", "emailVerifiedAt" FROM "User" WHERE id=${userId} FOR UPDATE
  `;
  return user;
}
