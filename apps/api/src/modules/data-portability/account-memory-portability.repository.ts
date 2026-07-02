import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  MemoryScope,
  MemorySource,
} from "../../generated/prisma/enums.js";
import { normalizeAccountMemoryContent } from "./account-memory-package.js";
import type {
  AccountMemoryPortabilityRecord,
  PersistedAccountMemoryImport,
  PortableAccountMemoryRecord,
} from "./account-memory-portability.types.js";

export interface AccountMemoryPortabilityRepository {
  importAccountMemories(
    userId: string,
    memories: PortableAccountMemoryRecord[]
  ): Promise<PersistedAccountMemoryImport>;
  listAccountMemories(userId: string): Promise<AccountMemoryPortabilityRecord[]>;
}

export function createPrismaAccountMemoryPortabilityRepository(
  database: typeof prisma = prisma
): AccountMemoryPortabilityRepository {
  return {
    async importAccountMemories(userId, memories) {
      return database.$transaction(
        async (tx) => {
          const existingMemories = await tx.memory.findMany({
            select: {
              content: true,
            },
            where: {
              scope: MemoryScope.USER,
              userId,
            },
          });
          const normalizedContents = new Set(
            existingMemories.map((memory) =>
              normalizeAccountMemoryContent(memory.content)
            )
          );
          let created = 0;
          let skippedExistingDuplicates = 0;

          for (const memory of memories) {
            const normalizedContent = normalizeAccountMemoryContent(
              memory.content
            );

            if (normalizedContents.has(normalizedContent)) {
              skippedExistingDuplicates += 1;
              continue;
            }

            await tx.memory.create({
              data: {
                confidence: 1,
                content: normalizedContent,
                scope: MemoryScope.USER,
                source: MemorySource.IMPORTED,
                userId,
              },
            });
            normalizedContents.add(normalizedContent);
            created += 1;
          }

          return {
            created,
            skippedExistingDuplicates,
            currentMemoryCount: existingMemories.length + created,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    },

    async listAccountMemories(userId) {
      return database.memory.findMany({
        orderBy: [
          {
            createdAt: "asc",
          },
          {
            id: "asc",
          },
        ],
        select: {
          id: true,
          content: true,
          source: true,
          createdAt: true,
          updatedAt: true,
        },
        where: {
          scope: MemoryScope.USER,
          userId,
        },
      });
    },
  };
}

export const accountMemoryPortabilityRepository =
  createPrismaAccountMemoryPortabilityRepository();
