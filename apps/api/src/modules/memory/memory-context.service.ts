import type { AiMemoryContext } from "../ai/ai.types.js";
import {
  projectDocumentsRepository,
  type ProjectDocumentRecord,
  type ProjectDocumentsRepository,
} from "../project-documents/project-documents.repository.js";
import {
  projectInstructionsRepository,
  type ProjectInstructionsRepository,
} from "../project-instructions/project-instructions.repository.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import {
  memoryRepository,
  type MemoryRecord,
  type MemoryRepository,
} from "./memory.repository.js";

const MAX_MEMORY_ITEMS_PER_SCOPE = 8;
const MAX_MEMORY_ITEM_CHARS = 700;
const MAX_PROJECT_INSTRUCTION_CHARS = 4000;
const MAX_PROJECT_DOCUMENTS = 4;
const MAX_PROJECT_DOCUMENT_CHARS = 2000;

export interface MemoryContextDependencies {
  documentsRepository: ProjectDocumentsRepository;
  instructionsRepository: ProjectInstructionsRepository;
  projectAccess: ProjectAccessService;
  repository: MemoryRepository;
}

export interface ChatMemoryContextInput {
  projectId?: string | null;
  userId?: string;
}

export function createMemoryContextService({
  documentsRepository,
  instructionsRepository,
  projectAccess,
  repository,
}: MemoryContextDependencies) {
  async function loadChatMemoryContext(input: ChatMemoryContextInput): Promise<AiMemoryContext | undefined> {
    if (!input.userId) return undefined;

    const accountMemories = await repository.listAccountMemories(input.userId);
    const projectContext = input.projectId ? await listOwnedProjectContext(input.userId, input.projectId) : {
      documents: [],
      instruction: null,
    };
    const context = {
      account: compactMemoryItems(accountMemories),
      projectInstruction: compactProjectInstruction(projectContext.instruction?.content || ""),
      projectDocuments: compactProjectDocuments(projectContext.documents),
    };

    if (!context.projectInstruction && context.account.length === 0 && context.projectDocuments.length === 0) {
      return undefined;
    }

    return context;
  }

  async function listOwnedProjectContext(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);

    const [instruction, documents] = await Promise.all([
      instructionsRepository.findProjectInstruction(projectId),
      documentsRepository.listProjectDocuments(projectId),
    ]);

    return {
      documents,
      instruction,
    };
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

  return normalized.length > MAX_MEMORY_ITEM_CHARS ? `${normalized.slice(0, MAX_MEMORY_ITEM_CHARS - 3)}...` : normalized;
}

function compactProjectInstruction(content: string) {
  return compactStructuredContent(content, MAX_PROJECT_INSTRUCTION_CHARS);
}

function compactProjectDocuments(documents: ProjectDocumentRecord[]) {
  return documents
    .map((document) => ({
      content: compactDocumentContent(document.content),
      title: compactDocumentTitle(document.title),
    }))
    .filter((document) => document.title && document.content)
    .slice(0, MAX_PROJECT_DOCUMENTS);
}

function compactDocumentTitle(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

function compactDocumentContent(content: string) {
  return compactStructuredContent(content, MAX_PROJECT_DOCUMENT_CHARS);
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
  documentsRepository: projectDocumentsRepository,
  instructionsRepository: projectInstructionsRepository,
  projectAccess: projectAccessService,
  repository: memoryRepository,
});
