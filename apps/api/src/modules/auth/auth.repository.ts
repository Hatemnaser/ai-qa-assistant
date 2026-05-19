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

export interface AuthRepository {
  createPasswordUser(input: CreatePasswordUserInput): Promise<AuthUserRecord>;
  createSession(input: CreateSessionInput): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
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
  };
}

export const authRepository = createPrismaAuthRepository();
