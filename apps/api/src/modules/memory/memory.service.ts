import { AppError } from "../../lib/errors.js";
import {
  memoryRepository,
  type MemoryRecord,
  type MemoryRepository,
} from "./memory.repository.js";
import type { MemoryDto, MemoryInput } from "./memory.types.js";

export interface MemoryServiceDependencies {
  repository: MemoryRepository;
}

export function createMemoryService({ repository }: MemoryServiceDependencies) {
  async function listAccountMemories(userId: string): Promise<MemoryDto[]> {
    const memories = await repository.listAccountMemories(userId);

    return memories.map(toMemoryDto);
  }

  async function createAccountMemory(userId: string, input: MemoryInput): Promise<MemoryDto> {
    const memory = await repository.createAccountMemory({
      content: input.content,
      userId,
    });

    return toMemoryDto(memory);
  }

  async function updateAccountMemory(userId: string, memoryId: string, input: MemoryInput): Promise<MemoryDto> {
    const memory = await repository.updateAccountMemory({
      content: input.content,
      memoryId,
      userId,
    });

    if (!memory) {
      throw new AppError("Memory was not found.", 404, "MEMORY_NOT_FOUND");
    }

    return toMemoryDto(memory);
  }

  async function deleteAccountMemory(userId: string, memoryId: string) {
    const deletedCount = await repository.deleteAccountMemory(userId, memoryId);

    if (deletedCount === 0) {
      throw new AppError("Memory was not found.", 404, "MEMORY_NOT_FOUND");
    }
  }

  async function listProjectMemories(userId: string, projectId: string): Promise<MemoryDto[]> {
    await assertOwnedProject(userId, projectId);

    const memories = await repository.listProjectMemories(projectId);

    return memories.map(toMemoryDto);
  }

  async function createProjectMemory(userId: string, projectId: string, input: MemoryInput): Promise<MemoryDto> {
    await assertOwnedProject(userId, projectId);

    const memory = await repository.createProjectMemory({
      content: input.content,
      projectId,
    });

    return toMemoryDto(memory);
  }

  async function updateProjectMemory(
    userId: string,
    projectId: string,
    memoryId: string,
    input: MemoryInput
  ): Promise<MemoryDto> {
    await assertOwnedProject(userId, projectId);

    const memory = await repository.updateProjectMemory({
      content: input.content,
      memoryId,
      projectId,
    });

    if (!memory) {
      throw new AppError("Memory was not found.", 404, "MEMORY_NOT_FOUND");
    }

    return toMemoryDto(memory);
  }

  async function deleteProjectMemory(userId: string, projectId: string, memoryId: string) {
    await assertOwnedProject(userId, projectId);

    const deletedCount = await repository.deleteProjectMemory(projectId, memoryId);

    if (deletedCount === 0) {
      throw new AppError("Memory was not found.", 404, "MEMORY_NOT_FOUND");
    }
  }

  async function assertOwnedProject(userId: string, projectId: string) {
    const project = await repository.findProjectOwner(projectId);

    if (!project || project.ownerId !== userId) {
      throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
    }
  }

  return {
    createAccountMemory,
    createProjectMemory,
    deleteAccountMemory,
    deleteProjectMemory,
    listAccountMemories,
    listProjectMemories,
    updateAccountMemory,
    updateProjectMemory,
  };
}

function toMemoryDto(memory: MemoryRecord): MemoryDto {
  return {
    id: memory.id,
    projectId: memory.projectId,
    scope: memory.scope,
    content: memory.content,
    source: memory.source,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export const memoryService = createMemoryService({
  repository: memoryRepository,
});
