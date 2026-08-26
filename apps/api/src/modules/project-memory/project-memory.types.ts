import type { MemorySource } from "../../generated/prisma/enums.js";
export const PROJECT_MEMORY_MAX_CHARS = 6000;

export interface ProjectMemoryDto {
  content: string;
  createdAt: string;
  projectId: string;
  source: MemorySource;
  updatedAt: string;
}

export interface ProjectMemoryInput {
  content: string;
}

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
