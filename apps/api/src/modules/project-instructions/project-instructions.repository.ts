import { prisma } from "../../db/prisma.js";

export interface ProjectInstructionRecord {
  projectId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectInstructionsRepository {
  deleteProjectInstruction(projectId: string): Promise<void>;
  findProjectInstruction(projectId: string): Promise<ProjectInstructionRecord | null>;
  upsertProjectInstruction(projectId: string, content: string): Promise<ProjectInstructionRecord>;
}

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
