import { prisma } from "../../db/prisma.js";
import type { ProjectMemoryRepository } from "./project-memory.types.js";

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
