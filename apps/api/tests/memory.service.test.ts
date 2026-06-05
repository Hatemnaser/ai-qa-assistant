import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryScope, MemorySource } from "../src/generated/prisma/enums.ts";
import type { MemoryRecord, MemoryRepository } from "../src/modules/memory/memory.repository.ts";
import { memoryInputSchema } from "../src/modules/memory/memory.schema.ts";
import { createMemoryService } from "../src/modules/memory/memory.service.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("memory service", () => {
  it("keeps account memory isolated by user", async () => {
    const { service } = setupMemoryService([
      createFakeMemoryRecord({
        content: "Current user preference",
        id: "memory-1",
        userId: "user-1",
      }),
      createFakeMemoryRecord({
        content: "Other user preference",
        id: "memory-2",
        userId: "user-2",
      }),
    ]);

    const memories = await service.listAccountMemories("user-1");

    assert.deepEqual(
      memories.map((memory) => memory.id),
      ["memory-1"]
    );
  });

  it("creates manual account and project memory in separate scopes", async () => {
    const { repository, service } = setupMemoryService([], [createFakeProject("project-1", "user-1")]);

    const accountMemory = await service.createAccountMemory("user-1", {
      content: "Always answer in concise QA steps.",
    });
    const projectMemory = await service.createProjectMemory("user-1", "project-1", {
      content: "Checkout supports PayPal and card payments.",
    });

    assert.equal(accountMemory.scope, MemoryScope.USER);
    assert.equal(accountMemory.projectId, null);
    assert.equal(projectMemory.scope, MemoryScope.PROJECT);
    assert.equal(projectMemory.projectId, "project-1");
    assert.deepEqual(
      repository.memories.map((memory) => memory.source),
      [MemorySource.USER_PROVIDED, MemorySource.USER_PROVIDED]
    );
  });

  it("keeps project memory isolated by project ownership", async () => {
    const { service } = setupMemoryService(
      [
        createFakeMemoryRecord({
          content: "Owned project context",
          id: "memory-1",
          projectId: "project-1",
          scope: MemoryScope.PROJECT,
          userId: null,
        }),
      ],
      [createFakeProject("project-1", "user-1")]
    );

    await assert.rejects(() => service.listProjectMemories("user-2", "project-1"), {
      code: "PROJECT_NOT_FOUND",
      statusCode: 404,
    });

    const memories = await service.listProjectMemories("user-1", "project-1");

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.content, "Owned project context");
  });

  it("updates and deletes only memories in the requested scope", async () => {
    const { repository, service } = setupMemoryService(
      [
        createFakeMemoryRecord({
          content: "Old account note",
          id: "memory-1",
          scope: MemoryScope.USER,
          userId: "user-1",
        }),
        createFakeMemoryRecord({
          content: "Project note",
          id: "memory-2",
          projectId: "project-1",
          scope: MemoryScope.PROJECT,
          userId: null,
        }),
      ],
      [createFakeProject("project-1", "user-1")]
    );

    const updated = await service.updateAccountMemory("user-1", "memory-1", {
      content: "New account note",
    });
    await service.deleteProjectMemory("user-1", "project-1", "memory-2");

    assert.equal(updated.content, "New account note");
    assert.deepEqual(
      repository.memories.map((memory) => memory.id),
      ["memory-1"]
    );
  });

  it("normalizes memory input", () => {
    const input = memoryInputSchema.parse({
      content: "  Prefer risk-based test cases.  ",
    });

    assert.deepEqual(input, {
      content: "Prefer risk-based test cases.",
    });
  });
});

function setupMemoryService(initialMemories: FakeMemoryRecord[] = [], projects: FakeProject[] = []) {
  const repository = createFakeMemoryRepository(initialMemories, projects);
  const service = createMemoryService({
    repository,
  });

  return {
    repository,
    service,
  };
}

interface FakeMemoryRecord extends MemoryRecord {
  userId: string | null;
}

interface FakeProject {
  id: string;
  ownerId: string;
}

interface FakeMemoryRepository extends MemoryRepository {
  memories: FakeMemoryRecord[];
  projects: FakeProject[];
}

function createFakeMemoryRepository(
  initialMemories: FakeMemoryRecord[] = [],
  projects: FakeProject[] = []
): FakeMemoryRepository {
  const repository: FakeMemoryRepository = {
    memories: [...initialMemories],
    projects: [...projects],

    async createAccountMemory(input) {
      const memory = createFakeMemoryRecord({
        content: input.content,
        id: `memory-${repository.memories.length + 1}`,
        scope: MemoryScope.USER,
        userId: input.userId,
      });

      repository.memories.push(memory);

      return memory;
    },

    async createProjectMemory(input) {
      const memory = createFakeMemoryRecord({
        content: input.content,
        id: `memory-${repository.memories.length + 1}`,
        projectId: input.projectId,
        scope: MemoryScope.PROJECT,
        userId: null,
      });

      repository.memories.push(memory);

      return memory;
    },

    async deleteAccountMemory(userId, memoryId) {
      return deleteMemory((memory) => memory.id === memoryId && memory.userId === userId && memory.scope === MemoryScope.USER);
    },

    async deleteProjectMemory(projectId, memoryId) {
      return deleteMemory(
        (memory) => memory.id === memoryId && memory.projectId === projectId && memory.scope === MemoryScope.PROJECT
      );
    },

    async findProjectOwner(projectId) {
      const project = repository.projects.find((item) => item.id === projectId);

      return project ? { ownerId: project.ownerId } : null;
    },

    async listAccountMemories(userId) {
      return repository.memories
        .filter((memory) => memory.scope === MemoryScope.USER && memory.userId === userId)
        .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());
    },

    async listProjectMemories(projectId) {
      return repository.memories
        .filter((memory) => memory.scope === MemoryScope.PROJECT && memory.projectId === projectId)
        .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());
    },

    async updateAccountMemory(input) {
      const memory = repository.memories.find(
        (item) => item.id === input.memoryId && item.userId === input.userId && item.scope === MemoryScope.USER
      );

      if (!memory) return null;

      memory.content = input.content;
      memory.updatedAt = NOW;

      return memory;
    },

    async updateProjectMemory(input) {
      const memory = repository.memories.find(
        (item) =>
          item.id === input.memoryId && item.projectId === input.projectId && item.scope === MemoryScope.PROJECT
      );

      if (!memory) return null;

      memory.content = input.content;
      memory.updatedAt = NOW;

      return memory;
    },
  };

  function deleteMemory(predicate: (memory: FakeMemoryRecord) => boolean) {
    const memoryIndex = repository.memories.findIndex(predicate);

    if (memoryIndex === -1) return 0;

    repository.memories.splice(memoryIndex, 1);

    return 1;
  }

  return repository;
}

function createFakeMemoryRecord(overrides: Partial<FakeMemoryRecord> = {}): FakeMemoryRecord {
  return {
    id: "memory-1",
    projectId: null,
    scope: MemoryScope.USER,
    content: "Memory note",
    source: MemorySource.USER_PROVIDED,
    createdAt: new Date("2026-06-06T09:00:00.000Z"),
    updatedAt: new Date("2026-06-06T09:00:00.000Z"),
    userId: "user-1",
    ...overrides,
  };
}

function createFakeProject(id: string, ownerId: string): FakeProject {
  return {
    id,
    ownerId,
  };
}
