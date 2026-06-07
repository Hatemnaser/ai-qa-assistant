import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryScope, MemorySource } from "../src/generated/prisma/enums.ts";
import type { MemoryRecord, MemoryRepository } from "../src/modules/memory/memory.repository.ts";
import { createMemoryContextService } from "../src/modules/memory/memory-context.service.ts";
import type {
  ProjectDocumentRecord,
  ProjectDocumentsRepository,
} from "../src/modules/project-documents/project-documents.repository.ts";
import type {
  ProjectInstructionRecord,
  ProjectInstructionsRepository,
} from "../src/modules/project-instructions/project-instructions.repository.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("memory context service", () => {
  it("loads account memory without project memory for normal chats", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository(),
      instructionsRepository: createFakeProjectInstructionsRepository(),
      projectAccess: createFakeProjectAccess(),
      repository: createFakeMemoryRepository({
        memories: [
          createFakeMemoryRecord({
            content: "Prefer concise QA answers.",
            scope: MemoryScope.USER,
            userId: "user-1",
          }),
          createFakeMemoryRecord({
            content: "Other user memory",
            id: "memory-2",
            scope: MemoryScope.USER,
            userId: "user-2",
          }),
        ],
      }),
    });

    const context = await service.loadChatMemoryContext({
      userId: "user-1",
    });

    assert.deepEqual(context, {
      account: ["Prefer concise QA answers."],
      projectInstruction: "",
      projectDocuments: [],
    });
  });

  it("loads project instructions and documents before account memory for owned project chats", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository({
        documents: [
          createFakeProjectDocumentRecord({
            content: "Guest checkout is disabled for regulated products.",
            projectId: "project-1",
            title: "Checkout rules",
          }),
        ],
      }),
      instructionsRepository: createFakeProjectInstructionsRepository({
        instructions: [
          createFakeProjectInstructionRecord({
            content: "Checkout supports card and PayPal.",
            projectId: "project-1",
          }),
        ],
      }),
      projectAccess: createFakeProjectAccess(new Map([["project-1", "user-1"]])),
      repository: createFakeMemoryRepository({
        memories: [
          createFakeMemoryRecord({
            content: "Use risk-based QA style.",
            id: "memory-account",
            scope: MemoryScope.USER,
            userId: "user-1",
          }),
        ],
      }),
    });

    const context = await service.loadChatMemoryContext({
      projectId: "project-1",
      userId: "user-1",
    });

    assert.deepEqual(context, {
      account: ["Use risk-based QA style."],
      projectInstruction: "Checkout supports card and PayPal.",
      projectDocuments: [
        {
          content: "Guest checkout is disabled for regulated products.",
          title: "Checkout rules",
        },
      ],
    });
  });

  it("rejects project context lookup for projects owned by another user", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository(),
      instructionsRepository: createFakeProjectInstructionsRepository(),
      projectAccess: createFakeProjectAccess(new Map([["project-1", "user-2"]])),
      repository: createFakeMemoryRepository(),
    });

    await assert.rejects(
      () =>
        service.loadChatMemoryContext({
          projectId: "project-1",
          userId: "user-1",
        }),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
  });

  it("limits and compacts memory notes for prompt safety", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository(),
      instructionsRepository: createFakeProjectInstructionsRepository(),
      projectAccess: createFakeProjectAccess(),
      repository: createFakeMemoryRepository({
        memories: Array.from({ length: 10 }, (_, index) =>
          createFakeMemoryRecord({
            content: `  Memory\n\n${index + 1}  `,
            id: `memory-${index + 1}`,
            scope: MemoryScope.USER,
            userId: "user-1",
          })
        ),
      }),
    });

    const context = await service.loadChatMemoryContext({
      userId: "user-1",
    });

    assert.equal(context?.account.length, 8);
    assert.equal(context?.account[0], "Memory 1");
  });

  it("limits and compacts project documents for prompt safety", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository({
        documents: Array.from({ length: 6 }, (_, index) =>
          createFakeProjectDocumentRecord({
            content: `  Document\n\n  ${index + 1}  `,
            id: `document-${index + 1}`,
            projectId: "project-1",
            title: `  Doc ${index + 1}  `,
          })
        ),
      }),
      instructionsRepository: createFakeProjectInstructionsRepository(),
      projectAccess: createFakeProjectAccess(new Map([["project-1", "user-1"]])),
      repository: createFakeMemoryRepository(),
    });

    const context = await service.loadChatMemoryContext({
      projectId: "project-1",
      userId: "user-1",
    });

    assert.equal(context?.projectDocuments?.length, 4);
    assert.deepEqual(context?.projectDocuments?.[0], {
      content: "Document\n\n  1",
      title: "Doc 1",
    });
  });

  it("preserves meaningful line structure in project instructions", async () => {
    const service = createMemoryContextService({
      documentsRepository: createFakeProjectDocumentsRepository(),
      instructionsRepository: createFakeProjectInstructionsRepository({
        instructions: [
          createFakeProjectInstructionRecord({
            content: "Use these rules:\r\n- Keep steps concise\r\n- Include expected results",
          }),
        ],
      }),
      projectAccess: createFakeProjectAccess(new Map([["project-1", "user-1"]])),
      repository: createFakeMemoryRepository(),
    });

    const context = await service.loadChatMemoryContext({
      projectId: "project-1",
      userId: "user-1",
    });

    assert.equal(
      context?.projectInstruction,
      "Use these rules:\n- Keep steps concise\n- Include expected results"
    );
  });
});

function createFakeMemoryRepository(input: {
  memories?: FakeMemoryRecord[];
} = {}): MemoryRepository {
  const memories = input.memories || [];

  return {
    async createAccountMemory() {
      throw new Error("not implemented");
    },

    async deleteAccountMemory() {
      throw new Error("not implemented");
    },

    async listAccountMemories(userId) {
      return memories.filter((memory) => memory.scope === MemoryScope.USER && memory.userId === userId);
    },

    async updateAccountMemory() {
      throw new Error("not implemented");
    },
  };
}

function createFakeProjectInstructionsRepository(input: {
  instructions?: ProjectInstructionRecord[];
} = {}): ProjectInstructionsRepository {
  const instructions = input.instructions || [];

  return {
    async deleteProjectInstruction() {
      throw new Error("not implemented");
    },

    async findProjectInstruction(projectId) {
      return instructions.find((instruction) => instruction.projectId === projectId) || null;
    },

    async upsertProjectInstruction() {
      throw new Error("not implemented");
    },
  };
}

function createFakeProjectDocumentsRepository(input: {
  documents?: ProjectDocumentRecord[];
} = {}): ProjectDocumentsRepository {
  const documents = input.documents || [];

  return {
    async createProjectDocument() {
      throw new Error("not implemented");
    },

    async createProjectDocuments() {
      throw new Error("not implemented");
    },

    async deleteProjectDocument() {
      throw new Error("not implemented");
    },

    async findProjectDocument() {
      throw new Error("not implemented");
    },

    async listProjectDocuments(projectId) {
      return documents.filter((document) => document.projectId === projectId);
    },

    async updateProjectDocument() {
      throw new Error("not implemented");
    },
  };
}

interface FakeMemoryRecord extends MemoryRecord {
  userId: string | null;
}

function createFakeMemoryRecord(overrides: Partial<FakeMemoryRecord> = {}): FakeMemoryRecord {
  return {
    id: "memory-1",
    projectId: null,
    scope: MemoryScope.USER,
    content: "Memory note",
    source: MemorySource.USER_PROVIDED,
    createdAt: NOW,
    updatedAt: NOW,
    userId: "user-1",
    ...overrides,
  };
}

function createFakeProjectDocumentRecord(overrides: Partial<ProjectDocumentRecord> = {}): ProjectDocumentRecord {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
    mimeType: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createFakeProjectInstructionRecord(
  overrides: Partial<ProjectInstructionRecord> = {}
): ProjectInstructionRecord {
  return {
    projectId: "project-1",
    content: "Project instructions",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
