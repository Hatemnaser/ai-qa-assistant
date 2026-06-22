import { prisma } from "../../db/prisma.js";
import type { AuthRequestContext, AuthSessionRecord, AuthUserRecord } from "./auth.types.js";

export interface CreatePasswordUserInput {
  email: string;
  locale: string;
  name?: string;
  passwordHash: string;
}

export interface CreateSessionInput extends AuthRequestContext {
  expiresAt: Date;
  tokenHash: string;
  userId: string;
}

export interface CreatePasswordResetTokenInput {
  expiresAt: Date;
  tokenHash: string;
  userId: string;
}

export interface CreateEmailVerificationTokenInput {
  expiresAt: Date;
  now: Date;
  tokenHash: string;
  userId: string;
}

export interface ResetPasswordWithTokenInput {
  newPasswordHash: string;
  now: Date;
  tokenHash: string;
}

export interface VerifyEmailWithTokenInput {
  now: Date;
  tokenHash: string;
}

export interface AuthRepository {
  createPasswordUser(input: CreatePasswordUserInput): Promise<AuthUserRecord>;
  createEmailVerificationToken(input: CreateEmailVerificationTokenInput): Promise<void>;
  createPasswordResetToken(input: CreatePasswordResetTokenInput): Promise<void>;
  createSession(input: CreateSessionInput): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  resetPasswordWithToken(input: ResetPasswordWithTokenInput): Promise<boolean>;
  verifyEmailWithToken(input: VerifyEmailWithTokenInput): Promise<boolean>;
}

export function createPrismaAuthRepository(): AuthRepository {
  return {
    async createPasswordUser(input) {
      return prisma.user.create({
        data: {
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
      await prisma.$transaction(async (tx) => {
        await tx.emailVerificationToken.updateMany({
          data: {
            usedAt: input.now,
          },
          where: {
            userId: input.userId,
            usedAt: null,
          },
        });

        await tx.emailVerificationToken.create({
          data: {
            expiresAt: input.expiresAt,
            tokenHash: input.tokenHash,
            userId: input.userId,
          },
        });
      });
    },

    async createPasswordResetToken(input) {
      await prisma.passwordResetToken.create({
        data: {
          expiresAt: input.expiresAt,
          tokenHash: input.tokenHash,
          userId: input.userId,
        },
      });
    },

    async createSession(input) {
      await prisma.session.create({
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
      await prisma.session.deleteMany({
        where: {
          tokenHash,
        },
      });
    },

    async findSessionByTokenHash(tokenHash) {
      return prisma.session.findUnique({
        include: {
          user: true,
        },
        where: {
          tokenHash,
        },
      });
    },

    async findUserByEmail(email) {
      return prisma.user.findUnique({
        where: {
          email,
        },
      });
    },

    async resetPasswordWithToken(input) {
      return prisma.$transaction(async (tx) => {
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

        await tx.session.deleteMany({
          where: {
            userId: resetToken.userId,
          },
        });

        return true;
      });
    },

    async verifyEmailWithToken(input) {
      return prisma.$transaction(async (tx) => {
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

        return true;
      });
    },
  };
}

export const authRepository = createPrismaAuthRepository();
