import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextTick, ref } from "vue";

import {
  useProjectMemory,
  type ProjectMemoryDependencies,
} from "../src/features/project-memory/useProjectMemory.ts";
import type { ProjectMemory } from "../src/features/project-memory/types.ts";

describe("useProjectMemory", () => {
  it("tracks loading and exposes the current saved memory", async () => {
    const request = createDeferred<ProjectMemory | null>();
    const activeProjectId = ref<string | null>("project-1");
    const projectMemory = useProjectMemory(
      activeProjectId,
      createDependencies({
        fetchMemory: async () => request.promise,
      })
    );

    assert.equal(projectMemory.isLoadingProjectMemory.value, true);

    request.resolve(createMemory());
    await flushPromises();

    assert.equal(projectMemory.isLoadingProjectMemory.value, false);
    assert.equal(projectMemory.projectMemory.value?.content, "## Stack\nTypeScript");
    assert.equal(projectMemory.projectMemoryDraft.value, "## Stack\nTypeScript");
    assert.equal(projectMemory.hasUnsavedMemoryChanges.value, false);
  });

  it("preserves an explicit empty state when no memory exists", async () => {
    const projectMemory = useProjectMemory(
      ref<string | null>("project-1"),
      createDependencies({
        async fetchMemory() {
          return null;
        },
      })
    );

    await flushPromises();

    assert.equal(projectMemory.projectMemory.value, null);
    assert.equal(projectMemory.projectMemoryDraft.value, "");
    assert.equal(projectMemory.isLoadingProjectMemory.value, false);
  });

  it("saves edits and clears saved memory only through explicit actions", async () => {
    const writes: string[] = [];
    const projectMemory = useProjectMemory(
      ref<string | null>("project-1"),
      createDependencies({
        async saveMemory(projectId, content) {
          assert.equal(projectId, "project-1");
          writes.push(content);
          return content ? createMemory({ content }) : null;
        },
      })
    );

    await flushPromises();

    projectMemory.projectMemoryDraft.value = "  ## Decisions\nUse PostgreSQL  ";
    await projectMemory.saveProjectMemory();

    assert.deepEqual(writes, ["## Decisions\nUse PostgreSQL"]);
    assert.equal(projectMemory.projectMemory.value?.content, "## Decisions\nUse PostgreSQL");
    assert.equal(projectMemory.projectMemoryStatusMessage.value, "Project memory saved.");

    await projectMemory.clearProjectMemory();

    assert.deepEqual(writes, ["## Decisions\nUse PostgreSQL", ""]);
    assert.equal(projectMemory.projectMemory.value, null);
    assert.equal(projectMemory.projectMemoryDraft.value, "");
    assert.equal(projectMemory.projectMemoryStatusMessage.value, "Project memory cleared.");
  });

  it("does not clear saved memory through the normal save action", async () => {
    const writes: string[] = [];
    const projectMemory = useProjectMemory(
      ref<string | null>("project-1"),
      createDependencies({
        async saveMemory(_projectId, content) {
          writes.push(content);
          return content ? createMemory({ content }) : null;
        },
      })
    );

    await flushPromises();

    projectMemory.updateProjectMemoryDraft("   ");
    await projectMemory.saveProjectMemory();

    assert.deepEqual(writes, []);
    assert.equal(projectMemory.projectMemory.value?.content, "## Stack\nTypeScript");

    await projectMemory.clearProjectMemory();

    assert.deepEqual(writes, [""]);
    assert.equal(projectMemory.projectMemory.value, null);
  });

  it("does not save unsaved draft changes automatically", async () => {
    const writes: string[] = [];
    const projectMemory = useProjectMemory(
      ref<string | null>("project-1"),
      createDependencies({
        async saveMemory(_projectId, content) {
          writes.push(content);
          return createMemory({ content });
        },
      })
    );

    await flushPromises();

    projectMemory.updateProjectMemoryDraft("Unsaved manual edit");
    await nextTick();

    assert.deepEqual(writes, []);
    assert.equal(projectMemory.projectMemory.value?.content, "## Stack\nTypeScript");

    await projectMemory.saveProjectMemory();

    assert.deepEqual(writes, ["Unsaved manual edit"]);
  });
});

function createDependencies(
  overrides: Partial<ProjectMemoryDependencies> = {}
): ProjectMemoryDependencies {
  const dependencies: ProjectMemoryDependencies = {
    async fetchMemory() {
      return createMemory();
    },
    async saveMemory(_projectId, content) {
      return content ? createMemory({ content }) : null;
    },
  };

  return {
    ...dependencies,
    ...overrides,
  };
}

function createMemory(overrides: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    content: "## Stack\nTypeScript",
    createdAt: "2026-06-14T10:00:00.000Z",
    projectId: "project-1",
    source: "USER_PROVIDED",
    updatedAt: "2026-06-14T10:00:00.000Z",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
}
