import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryScope, MemorySource } from "../src/generated/prisma/enums.ts";
import type { MemoryRecord, MemoryRepository } from "../src/modules/memory/memory.types.ts";
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

  it("creates manual account memory", async () => {
    const { repository, service } = setupMemoryService();

    const accountMemory = await service.createAccountMemory("user-1", {
      content: "Always answer in concise QA steps.",
    });

    assert.equal(accountMemory.scope, MemoryScope.USER);
    assert.equal(accountMemory.projectId, null);
    assert.equal(repository.memories[0]?.source, MemorySource.USER_PROVIDED);
  });

  it("updates and deletes only account memories owned by the user", async () => {
    const { repository, service } = setupMemoryService(
      [
        createFakeMemoryRecord({
          content: "Old account note",
          id: "memory-1",
          scope: MemoryScope.USER,
          userId: "user-1",
        }),
        createFakeMemoryRecord({
          content: "Other user note",
          id: "memory-2",
          scope: MemoryScope.USER,
          userId: "user-2",
        }),
      ]
    );

    const updated = await service.updateAccountMemory("user-1", "memory-1", {
      content: "New account note",
    });
    await assert.rejects(() => service.deleteAccountMemory("user-1", "memory-2"), {
      code: "MEMORY_NOT_FOUND",
      statusCode: 404,
    });
    await service.deleteAccountMemory("user-1", "memory-1");

    assert.equal(updated.content, "New account note");
    assert.deepEqual(
      repository.memories.map((memory) => memory.id),
      ["memory-2"]
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

function setupMemoryService(initialMemories: FakeMemoryRecord[] = []) {
  const repository = createFakeMemoryRepository(initialMemories);
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

interface FakeMemoryRepository extends MemoryRepository {
  memories: FakeMemoryRecord[];
}

function createFakeMemoryRepository(initialMemories: FakeMemoryRecord[] = []): FakeMemoryRepository {
  const repository: FakeMemoryRepository = {
    memories: [...initialMemories],

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

    async deleteAccountMemory(userId, memoryId) {
      return deleteMemory((memory) => memory.id === memoryId && memory.userId === userId && memory.scope === MemoryScope.USER);
    },

    async listAccountMemories(userId) {
      return repository.memories
        .filter((memory) => memory.scope === MemoryScope.USER && memory.userId === userId)
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
