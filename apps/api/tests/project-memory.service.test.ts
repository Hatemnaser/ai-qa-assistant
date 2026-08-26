import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemorySource } from "../src/generated/prisma/enums.ts";
import type {
  ProjectMemoryRecord,
  ProjectMemoryRepository,
} from "../src/modules/project-memory/project-memory.types.ts";
import { projectMemoryInputSchema } from "../src/modules/project-memory/project-memory.schema.ts";
import { createProjectMemoryService } from "../src/modules/project-memory/project-memory.service.ts";
import { PROJECT_MEMORY_MAX_CHARS } from "../src/modules/project-memory/project-memory.types.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";

const NOW = new Date("2026-06-14T14:00:00.000Z");

describe("project memory service", () => {
  it("creates, reads, and updates one memory record per owned project", async () => {
    const { repository, service } = setupProjectMemoryService(
      new Map([["project-1", "user-1"]])
    );

    const created = await service.saveProjectMemory("user-1", "project-1", {
      content: "## Stack\nVue and Express",
    });
    const updated = await service.saveProjectMemory("user-1", "project-1", {
      content: "## Decisions\nUse PostgreSQL",
    });
    const loaded = await service.getProjectMemory("user-1", "project-1");

    assert.equal(created?.projectId, "project-1");
    assert.equal(created?.source, MemorySource.USER_PROVIDED);
    assert.equal(updated?.createdAt, created?.createdAt);
    assert.equal(loaded?.content, "## Decisions\nUse PostgreSQL");
    assert.equal(repository.memories.size, 1);
  });

  it("clears project memory when content is empty", async () => {
    const { repository, service } = setupProjectMemoryService(
      new Map([["project-1", "user-1"]]),
      [createFakeProjectMemory()]
    );

    const result = await service.saveProjectMemory("user-1", "project-1", {
      content: "",
    });

    assert.equal(result, null);
    assert.equal(repository.memories.size, 0);
  });

  it("keeps missing and foreign projects behind the same access error", async () => {
    const { service } = setupProjectMemoryService(
      new Map([["project-1", "user-2"]])
    );

    await assert.rejects(
      () => service.getProjectMemory("user-1", "project-1"),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
    await assert.rejects(
      () => service.getProjectMemory("user-1", "missing-project"),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
  });

  it("normalizes and bounds manual project memory input", () => {
    assert.deepEqual(
      projectMemoryInputSchema.parse({
        content: "  ## Stack\nVue  ",
      }),
      {
        content: "## Stack\nVue",
      }
    );
    assert.throws(() =>
      projectMemoryInputSchema.parse({
        content: "x".repeat(PROJECT_MEMORY_MAX_CHARS + 1),
      })
    );
  });
});

interface FakeProjectMemoryRepository extends ProjectMemoryRepository {
  memories: Map<string, ProjectMemoryRecord>;
}

function setupProjectMemoryService(
  projectOwners: Map<string, string>,
  memories: ProjectMemoryRecord[] = []
) {
  const repository: FakeProjectMemoryRepository = {
    memories: new Map(memories.map((memory) => [memory.projectId, memory])),

    async deleteProjectMemory(projectId) {
      repository.memories.delete(projectId);
    },

    async findProjectMemory(projectId) {
      return repository.memories.get(projectId) || null;
    },

    async upsertProjectMemory(projectId, content) {
      const existing = repository.memories.get(projectId);
      const memory = createFakeProjectMemory({
        content,
        createdAt: existing?.createdAt || NOW,
        projectId,
        updatedAt: NOW,
      });

      repository.memories.set(projectId, memory);

      return memory;
    },
  };

  return {
    repository,
    service: createProjectMemoryService({
      projectAccess: createFakeProjectAccess(projectOwners),
      repository,
    }),
  };
}

function createFakeProjectMemory(
  overrides: Partial<ProjectMemoryRecord> = {}
): ProjectMemoryRecord {
  return {
    content: "## Stack\nTypeScript",
    createdAt: NOW,
    projectId: "project-1",
    source: MemorySource.USER_PROVIDED,
    updatedAt: NOW,
    ...overrides,
  };
}
