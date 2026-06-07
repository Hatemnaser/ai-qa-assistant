import { prisma } from "../../db/prisma.js";
import { MemoryScope, MemorySource } from "../../generated/prisma/enums.js";

export interface MemoryRecord {
  id: string;
  projectId: string | null;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAccountMemoryInput {
  content: string;
  userId: string;
}

export interface UpdateAccountMemoryInput {
  content: string;
  memoryId: string;
  userId: string;
}

export interface MemoryRepository {
  createAccountMemory(input: CreateAccountMemoryInput): Promise<MemoryRecord>;
  deleteAccountMemory(userId: string, memoryId: string): Promise<number>;
  listAccountMemories(userId: string): Promise<MemoryRecord[]>;
  updateAccountMemory(input: UpdateAccountMemoryInput): Promise<MemoryRecord | null>;
}

export function createPrismaMemoryRepository(): MemoryRepository {
  return {
    async createAccountMemory(input) {
      return prisma.memory.create({
        data: {
          content: input.content,
          confidence: 1,
          scope: MemoryScope.USER,
          source: MemorySource.USER_PROVIDED,
          userId: input.userId,
        },
      });
    },

    async deleteAccountMemory(userId, memoryId) {
      const result = await prisma.memory.deleteMany({
        where: {
          id: memoryId,
          scope: MemoryScope.USER,
          userId,
        },
      });

      return result.count;
    },

    async listAccountMemories(userId) {
      return prisma.memory.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          scope: MemoryScope.USER,
          userId,
        },
      });
    },

    async updateAccountMemory(input) {
      const result = await prisma.memory.updateMany({
        data: {
          content: input.content,
        },
        where: {
          id: input.memoryId,
          scope: MemoryScope.USER,
          userId: input.userId,
        },
      });

      if (result.count === 0) return null;

      return prisma.memory.findFirst({
        where: {
          id: input.memoryId,
          scope: MemoryScope.USER,
          userId: input.userId,
        },
      });
    },

  };
}

export const memoryRepository = createPrismaMemoryRepository();
