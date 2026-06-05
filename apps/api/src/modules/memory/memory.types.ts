import type { MemoryScope, MemorySource } from "../../generated/prisma/enums.js";

export interface MemoryDto {
  id: string;
  projectId: string | null;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  content: string;
}
