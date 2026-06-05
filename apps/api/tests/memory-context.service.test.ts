import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryScope, MemorySource } from "../src/generated/prisma/enums.ts";
import type { MemoryRecord, MemoryRepository } from "../src/modules/memory/memory.repository.ts";
import { createMemoryContextService } from "../src/modules/memory/memory-context.service.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("memory context service", () => {
  it("loads account memory without project memory for normal chats", async () => {
    const service = createMemoryContextService({
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
      project: [],
    });
  });

  it("loads project memory before account memory for owned project chats", async () => {
    const service = createMemoryContextService({
      repository: createFakeMemoryRepository({
        memories: [
          createFakeMemoryRecord({
            content: "Use risk-based QA style.",
            id: "memory-account",
            scope: MemoryScope.USER,
            userId: "user-1",
          }),
          createFakeMemoryRecord({
            content: "Checkout supports card and PayPal.",
            id: "memory-project",
            projectId: "project-1",
            scope: MemoryScope.PROJECT,
            userId: null,
          }),
        ],
        projectOwners: new Map([["project-1", "user-1"]]),
      }),
    });

    const context = await service.loadChatMemoryContext({
      projectId: "project-1",
      userId: "user-1",
    });

    assert.deepEqual(context, {
      account: ["Use risk-based QA style."],
      project: ["Checkout supports card and PayPal."],
    });
  });

  it("rejects project memory lookup for projects owned by another user", async () => {
    const service = createMemoryContextService({
      repository: createFakeMemoryRepository({
        projectOwners: new Map([["project-1", "user-2"]]),
      }),
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
});

function createFakeMemoryRepository(input: {
  memories?: FakeMemoryRecord[];
  projectOwners?: Map<string, string>;
} = {}): MemoryRepository {
  const memories = input.memories || [];
  const projectOwners = input.projectOwners || new Map<string, string>();

  return {
    async createAccountMemory() {
      throw new Error("not implemented");
    },

    async createProjectMemory() {
      throw new Error("not implemented");
    },

    async deleteAccountMemory() {
      throw new Error("not implemented");
    },

    async deleteProjectMemory() {
      throw new Error("not implemented");
    },

    async findProjectOwner(projectId) {
      const ownerId = projectOwners.get(projectId);

      return ownerId ? { ownerId } : null;
    },

    async listAccountMemories(userId) {
      return memories.filter((memory) => memory.scope === MemoryScope.USER && memory.userId === userId);
    },

    async listProjectMemories(projectId) {
      return memories.filter((memory) => memory.scope === MemoryScope.PROJECT && memory.projectId === projectId);
    },

    async updateAccountMemory() {
      throw new Error("not implemented");
    },

    async updateProjectMemory() {
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
