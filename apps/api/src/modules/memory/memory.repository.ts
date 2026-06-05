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

export interface CreateProjectMemoryInput {
  content: string;
  projectId: string;
}

export interface UpdateAccountMemoryInput {
  content: string;
  memoryId: string;
  userId: string;
}

export interface UpdateProjectMemoryInput {
  content: string;
  memoryId: string;
  projectId: string;
}

export interface MemoryRepository {
  createAccountMemory(input: CreateAccountMemoryInput): Promise<MemoryRecord>;
  createProjectMemory(input: CreateProjectMemoryInput): Promise<MemoryRecord>;
  deleteAccountMemory(userId: string, memoryId: string): Promise<number>;
  deleteProjectMemory(projectId: string, memoryId: string): Promise<number>;
  findProjectOwner(projectId: string): Promise<{ ownerId: string } | null>;
  listAccountMemories(userId: string): Promise<MemoryRecord[]>;
  listProjectMemories(projectId: string): Promise<MemoryRecord[]>;
  updateAccountMemory(input: UpdateAccountMemoryInput): Promise<MemoryRecord | null>;
  updateProjectMemory(input: UpdateProjectMemoryInput): Promise<MemoryRecord | null>;
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

    async createProjectMemory(input) {
      return prisma.memory.create({
        data: {
          content: input.content,
          confidence: 1,
          projectId: input.projectId,
          scope: MemoryScope.PROJECT,
          source: MemorySource.USER_PROVIDED,
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

    async deleteProjectMemory(projectId, memoryId) {
      const result = await prisma.memory.deleteMany({
        where: {
          id: memoryId,
          projectId,
          scope: MemoryScope.PROJECT,
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

    async listProjectMemories(projectId) {
      return prisma.memory.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          projectId,
          scope: MemoryScope.PROJECT,
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

    async updateProjectMemory(input) {
      const result = await prisma.memory.updateMany({
        data: {
          content: input.content,
        },
        where: {
          id: input.memoryId,
          projectId: input.projectId,
          scope: MemoryScope.PROJECT,
        },
      });

      if (result.count === 0) return null;

      return prisma.memory.findFirst({
        where: {
          id: input.memoryId,
          projectId: input.projectId,
          scope: MemoryScope.PROJECT,
        },
      });
    },
  };
}

export const memoryRepository = createPrismaMemoryRepository();
