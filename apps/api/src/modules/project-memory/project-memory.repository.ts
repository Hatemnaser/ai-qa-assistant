import type { MemorySource } from "../../generated/prisma/enums.js";
import { prisma } from "../../db/prisma.js";

export interface ProjectMemoryRecord {
  content: string;
  createdAt: Date;
  projectId: string;
  source: MemorySource;
  updatedAt: Date;
}

export interface ProjectMemoryRepository {
  deleteProjectMemory(projectId: string): Promise<void>;
  findProjectMemory(projectId: string): Promise<ProjectMemoryRecord | null>;
  upsertProjectMemory(
    projectId: string,
    content: string
  ): Promise<ProjectMemoryRecord>;
}

export function createPrismaProjectMemoryRepository(): ProjectMemoryRepository {
  return {
    async deleteProjectMemory(projectId) {
      await prisma.projectMemory.deleteMany({
        where: {
          projectId,
        },
      });
    },

    async findProjectMemory(projectId) {
      return prisma.projectMemory.findUnique({
        where: {
          projectId,
        },
      });
    },

    async upsertProjectMemory(projectId, content) {
      return prisma.projectMemory.upsert({
        create: {
          content,
          projectId,
        },
        update: {
          content,
        },
        where: {
          projectId,
        },
      });
    },
  };
}

export const projectMemoryRepository =
  createPrismaProjectMemoryRepository();
