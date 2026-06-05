import { AppError } from "../../lib/errors.js";
import type { AiMemoryContext } from "../ai/ai.types.js";
import {
  memoryRepository,
  type MemoryRecord,
  type MemoryRepository,
} from "./memory.repository.js";

const MAX_MEMORY_ITEMS_PER_SCOPE = 8;
const MAX_MEMORY_ITEM_CHARS = 700;

export interface MemoryContextDependencies {
  repository: MemoryRepository;
}

export interface ChatMemoryContextInput {
  projectId?: string | null;
  userId?: string;
}

export function createMemoryContextService({ repository }: MemoryContextDependencies) {
  async function loadChatMemoryContext(input: ChatMemoryContextInput): Promise<AiMemoryContext | undefined> {
    if (!input.userId) return undefined;

    const accountMemories = await repository.listAccountMemories(input.userId);
    const projectMemories = input.projectId ? await listOwnedProjectMemories(input.userId, input.projectId) : [];
    const context = {
      account: compactMemoryItems(accountMemories),
      project: compactMemoryItems(projectMemories),
    };

    if (context.account.length === 0 && context.project.length === 0) return undefined;

    return context;
  }

  async function listOwnedProjectMemories(userId: string, projectId: string) {
    const project = await repository.findProjectOwner(projectId);

    if (!project || project.ownerId !== userId) {
      throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
    }

    return repository.listProjectMemories(projectId);
  }

  return {
    loadChatMemoryContext,
  };
}

function compactMemoryItems(memories: MemoryRecord[]) {
  return memories
    .map((memory) => compactMemoryContent(memory.content))
    .filter(Boolean)
    .slice(0, MAX_MEMORY_ITEMS_PER_SCOPE);
}

function compactMemoryContent(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (!normalized) return "";

  return normalized.length > MAX_MEMORY_ITEM_CHARS ? `${normalized.slice(0, MAX_MEMORY_ITEM_CHARS - 1)}...` : normalized;
}

export const memoryContextService = createMemoryContextService({
  repository: memoryRepository,
});
