import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { MemoryScope, MemorySource } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import type { MemoryRepository } from "./memory.types.js";

export function createPrismaMemoryRepository(database: typeof prisma = prisma): MemoryRepository {
  return {
    async createAccountMemory(input) {
      return database.$transaction(async (tx) => {
        await lockUserMemoryQuota(tx, input.userId);
        const memoryCount = await tx.memory.count({
          where: { scope: MemoryScope.USER, userId: input.userId },
        });

        if (memoryCount >= DATA_LIMITS.accountMemoriesPerUser) {
          throw new AppError(
            `You can save up to ${DATA_LIMITS.accountMemoriesPerUser} account memories. Delete one before creating another.`,
            409,
            "MEMORY_LIMIT_REACHED"
          );
        }

        return tx.memory.create({
          data: {
            content: input.content,
            confidence: 1,
            scope: MemoryScope.USER,
            source: MemorySource.USER_PROVIDED,
            userId: input.userId,
          },
        });
      });
    },

    async deleteAccountMemory(userId, memoryId) {
      const result = await database.memory.deleteMany({
        where: {
          id: memoryId,
          scope: MemoryScope.USER,
          userId,
        },
      });

      return result.count;
    },

    async listAccountMemories(userId) {
      return database.memory.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        take: DATA_LIMITS.accountMemoriesPerUser,
        where: {
          scope: MemoryScope.USER,
          userId,
        },
      });
    },

    async updateAccountMemory(input) {
      const result = await database.memory.updateMany({
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

      return database.memory.findFirst({
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

async function lockUserMemoryQuota(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:memories:${userId}`}, 0))`;
}
