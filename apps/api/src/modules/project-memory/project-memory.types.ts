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
