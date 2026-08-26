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

export interface UpdateAccountMemoryInput {
  content: string;
  memoryId: string;
  userId: string;
}

export interface MemoryRepository {
  createAccountMemory(input: CreateAccountMemoryInput): Promise<MemoryRecord>;
  deleteAccountMemory(userId: string, memoryId: string): Promise<number>;
  listAccountMemories(userId: string): Promise<MemoryRecord[]>;
  updateAccountMemory(input: UpdateAccountMemoryInput): Promise<MemoryRecord | null>;
}
