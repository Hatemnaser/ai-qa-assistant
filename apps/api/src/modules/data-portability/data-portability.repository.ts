import { prisma } from "../../db/prisma.js";
import type { ProjectExportSourceRecord } from "./data-portability.types.js";

export interface DataPortabilityRepository {
  findOwnedProjectExportData(
    userId: string,
    projectId: string,
    includeChats: boolean
  ): Promise<ProjectExportSourceRecord | null>;
}

export function createPrismaDataPortabilityRepository(): DataPortabilityRepository {
  return {
    async findOwnedProjectExportData(userId, projectId, includeChats) {
      const project = await prisma.project.findFirst({
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
        where: {
          id: projectId,
          ownerId: userId,
        },
      });

      if (!project) return null;

      const chats = includeChats
        ? await prisma.chat.findMany({
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
            where: {
              projectId,
              userId,
            },
          })
        : [];

      return {
        ...project,
        chats,
      };
    },
  };
}

export const dataPortabilityRepository = createPrismaDataPortabilityRepository();
