import { prisma } from "../../db/prisma.js";
import { MemoryScope, MemorySource } from "../../generated/prisma/enums.js";
import type { AccountExportSourceRecord } from "./account-data-portability.types.js";

export interface AccountDataPortabilityRepository {
  findAccountExportData(userId: string): Promise<AccountExportSourceRecord | null>;
}

export function createPrismaAccountDataPortabilityRepository(
  database: typeof prisma = prisma
): AccountDataPortabilityRepository {
  return {
    async findAccountExportData(userId) {
      const account = await database.user.findUnique({
        select: {
          id: true,
          email: true,
          name: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
          settings: {
            select: {
              language: true,
              theme: true,
              defaultModel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          memories: {
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
              source: {
                in: [MemorySource.USER_PROVIDED, MemorySource.IMPORTED],
              },
            },
          },
          ownedProjects: {
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
              name: true,
              description: true,
              createdAt: true,
              updatedAt: true,
              instruction: {
                select: {
                  content: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
              projectMemory: {
                select: {
                  content: true,
                  source: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
              documents: {
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
                  title: true,
                  content: true,
                  source: true,
                  mimeType: true,
                  metadata: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          },
          chats: {
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
              projectId: true,
              title: true,
              mode: true,
              model: true,
              createdAt: true,
              updatedAt: true,
              messages: {
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
                  role: true,
                  content: true,
                  mode: true,
                  model: true,
                  attachment: true,
                  metadata: true,
                  createdAt: true,
                },
              },
            },
          },
        },
        where: {
          id: userId,
        },
      });

      if (!account) return null;

      return {
        ...account,
        projects: account.ownedProjects,
      };
    },
  };
}

export const accountDataPortabilityRepository =
  createPrismaAccountDataPortabilityRepository();
