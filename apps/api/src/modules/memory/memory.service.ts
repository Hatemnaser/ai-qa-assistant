import { AppError } from "../../lib/errors.js";
import { memoryRepository } from "./memory.repository.js";
import type {
  MemoryDto,
  MemoryInput,
  MemoryRecord,
  MemoryRepository,
} from "./memory.types.js";

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

  return {
    createAccountMemory,
    deleteAccountMemory,
    listAccountMemories,
    updateAccountMemory,
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
