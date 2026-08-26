import { prisma } from "../../db/prisma.js";
import type { ProjectInstructionsRepository } from "./project-instructions.types.js";

export function createPrismaProjectInstructionsRepository(): ProjectInstructionsRepository {
  return {
    async deleteProjectInstruction(projectId) {
      await prisma.projectInstruction.deleteMany({
        where: {
          projectId,
        },
      });
    },

    async findProjectInstruction(projectId) {
      return prisma.projectInstruction.findUnique({
        where: {
          projectId,
        },
      });
    },

    async upsertProjectInstruction(projectId, content) {
      return prisma.projectInstruction.upsert({
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

export const projectInstructionsRepository = createPrismaProjectInstructionsRepository();
