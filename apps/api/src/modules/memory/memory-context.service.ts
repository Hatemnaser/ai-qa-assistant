import type { AiMemoryContext } from "../ai/ai.types.js";
import {
  projectDocumentRetriever,
} from "../project-documents/project-document-hybrid-retrieval.js";
import {
  retrieveProjectDocumentChunks,
  type ProjectDocumentRetriever,
} from "../project-documents/project-document-retrieval.js";
import { projectDocumentsRepository } from "../project-documents/project-documents.repository.js";
import type {
  ProjectDocumentRecord,
  ProjectDocumentsRepository,
} from "../project-documents/project-documents.types.js";
import { projectInstructionsRepository } from "../project-instructions/project-instructions.repository.js";
import type { ProjectInstructionsRepository } from "../project-instructions/project-instructions.types.js";
import { projectMemoryRepository } from "../project-memory/project-memory.repository.js";
import {
  PROJECT_MEMORY_MAX_CHARS,
  type ProjectMemoryRepository,
} from "../project-memory/project-memory.types.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { memoryRepository } from "./memory.repository.js";
import type { MemoryRecord, MemoryRepository } from "./memory.types.js";

const MAX_MEMORY_ITEMS_PER_SCOPE = 8;
const MAX_MEMORY_ITEM_CHARS = 700;
const MAX_PROJECT_INSTRUCTION_CHARS = 4000;

export interface MemoryContextDependencies {
  documentRetriever?: ProjectDocumentRetriever;
  documentsRepository: ProjectDocumentsRepository;
  instructionsRepository: ProjectInstructionsRepository;
  projectMemoryRepository: ProjectMemoryRepository;
  projectAccess: ProjectAccessService;
  repository: MemoryRepository;
}

export interface ChatMemoryContextInput {
  projectId?: string | null;
  query: string;
  userId?: string;
}

export interface PreparedChatMemoryContext {
  context?: AiMemoryContext;
  documents: ProjectDocumentRecord[];
  projectId?: string;
  query: string;
  userId?: string;
}

export function createMemoryContextService({
  documentRetriever = projectDocumentRetriever,
  documentsRepository,
  instructionsRepository,
  projectMemoryRepository,
  projectAccess,
  repository,
}: MemoryContextDependencies) {
  async function prepareChatMemoryContext(
    input: ChatMemoryContextInput
  ): Promise<PreparedChatMemoryContext> {
    if (!input.userId) {
      return {
        documents: [],
        query: input.query,
      };
    }

    const accountMemories = await repository.listAccountMemories(input.userId);
    const projectContext = input.projectId ? await listOwnedProjectContext(input.userId, input.projectId) : {
      documents: [],
      instruction: null,
      memory: null,
    };
    const projectMemory = compactProjectMemory(
      projectContext.memory?.content || ""
    );
    const context = compactContext({
      behavior: {
        projectInstructions: compactProjectInstruction(projectContext.instruction?.content || ""),
      },
      durableMemory: {
        account: compactMemoryItems(accountMemories),
        ...(projectMemory ? { project: projectMemory } : {}),
      },
      evidence: {
        projectDocuments: retrieveProjectDocumentChunks({
          documents: projectContext.documents,
          query: input.query,
        }),
      },
    });

    return {
      context,
      documents: projectContext.documents,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      query: input.query,
      userId: input.userId,
    };
  }

  async function resolveChatMemoryContext(
    prepared: PreparedChatMemoryContext
  ): Promise<AiMemoryContext | undefined> {
    if (!prepared.projectId || prepared.documents.length === 0) {
      return prepared.context;
    }

    try {
      return compactContext({
        behavior: prepared.context?.behavior || {},
        durableMemory: prepared.context?.durableMemory || {
          account: [],
        },
        evidence: {
          projectDocuments: await documentRetriever.retrieve({
            documents: prepared.documents,
            projectId: prepared.projectId,
            query: prepared.query,
            userId: prepared.userId,
          }),
        },
      });
    } catch {
      return prepared.context;
    }
  }

  async function listOwnedProjectContext(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);

    const [instruction, memory, documents] = await Promise.all([
      instructionsRepository.findProjectInstruction(projectId),
      projectMemoryRepository.findProjectMemory(projectId),
      documentsRepository.listProjectDocuments(projectId),
    ]);

    return {
      documents,
      instruction,
      memory,
    };
  }

  return {
    prepareChatMemoryContext,
    resolveChatMemoryContext,
  };
}

function compactContext(context: AiMemoryContext) {
  if (
    !context.behavior.projectInstructions &&
    context.durableMemory.account.length === 0 &&
    !context.durableMemory.project &&
    context.evidence.projectDocuments.length === 0
  ) {
    return undefined;
  }

  return context;
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

  return normalized.length > MAX_MEMORY_ITEM_CHARS ? `${normalized.slice(0, MAX_MEMORY_ITEM_CHARS - 3)}...` : normalized;
}

function compactProjectInstruction(content: string) {
  return compactStructuredContent(content, MAX_PROJECT_INSTRUCTION_CHARS);
}

function compactProjectMemory(content: string) {
  return compactStructuredContent(content, PROJECT_MEMORY_MAX_CHARS);
}

function compactStructuredContent(content: string, maxChars: number) {
  const normalized = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return "";

  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
}

export const memoryContextService = createMemoryContextService({
  documentRetriever: projectDocumentRetriever,
  documentsRepository: projectDocumentsRepository,
  instructionsRepository: projectInstructionsRepository,
  projectMemoryRepository,
  projectAccess: projectAccessService,
  repository: memoryRepository,
});
