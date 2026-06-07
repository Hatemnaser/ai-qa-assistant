import { prisma } from "../../db/prisma.js";
import { ProjectRole } from "../../generated/prisma/enums.js";
import type { ProjectInput } from "./projects.types.js";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput extends ProjectInput {
  ownerId: string;
}

export interface UpdateProjectInput extends ProjectInput {
  projectId: string;
  userId: string;
}

export interface ProjectsRepository {
  createUserProject(input: CreateProjectInput): Promise<ProjectRecord>;
  deleteOwnedProject(userId: string, projectId: string): Promise<number>;
  findProjectOwner(projectId: string): Promise<{ ownerId: string } | null>;
  listUserProjects(userId: string): Promise<ProjectRecord[]>;
  updateOwnedProject(input: UpdateProjectInput): Promise<ProjectRecord | null>;
}

export function createPrismaProjectsRepository(): ProjectsRepository {
  return {
    async createUserProject(input) {
      return prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            description: input.description,
            name: input.name,
            ownerId: input.ownerId,
          },
        });

        await tx.projectMember.create({
          data: {
            projectId: project.id,
            role: ProjectRole.OWNER,
            userId: input.ownerId,
          },
        });

        return project;
      });
    },

    async deleteOwnedProject(userId, projectId) {
      const result = await prisma.project.deleteMany({
        where: {
          id: projectId,
          ownerId: userId,
        },
      });

      return result.count;
    },

    async findProjectOwner(projectId) {
      return prisma.project.findUnique({
        select: {
          ownerId: true,
        },
        where: {
          id: projectId,
        },
      });
    },

    async listUserProjects(userId) {
      return prisma.project.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          ownerId: userId,
        },
      });
    },

    async updateOwnedProject(input) {
      return prisma.$transaction(async (tx) => {
        const result = await tx.project.updateMany({
          data: {
            description: input.description,
            name: input.name,
          },
          where: {
            id: input.projectId,
            ownerId: input.userId,
          },
        });

        if (result.count === 0) return null;

        return tx.project.findFirst({
          where: {
            id: input.projectId,
            ownerId: input.userId,
          },
        });
      });
    },
  };
}

export const projectsRepository = createPrismaProjectsRepository();
