import { prisma } from "../../db/prisma.js";
import type { AuthRequestContext, AuthUserRecord } from "./auth.types.js";

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
