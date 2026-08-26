import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextTick, ref } from "vue";

import {
  useProjectKnowledge,
  type ProjectKnowledgeDependencies,
} from "../src/features/projects/composables/useProjectKnowledge";
import type { ProjectDocument } from "../src/features/project-documents/types";
import type { ProjectInstruction } from "../src/features/project-instructions/types";

describe("useProjectKnowledge", () => {
  it("ignores stale responses after the active project changes", async () => {
    const projectOneInstruction = createDeferred<ProjectInstruction | null>();
    const projectTwoInstruction = createDeferred<ProjectInstruction | null>();
    const projectOneDocuments = createDeferred<ProjectDocument[]>();
    const projectTwoDocuments = createDeferred<ProjectDocument[]>();
    const activeProjectId = ref<string | null>("project-1");
    const knowledge = useProjectKnowledge(
      activeProjectId,
      createDependencies({
        fetchDocuments: (projectId) =>
          projectId === "project-1" ? projectOneDocuments.promise : projectTwoDocuments.promise,
        fetchInstruction: (projectId) =>
          projectId === "project-1" ? projectOneInstruction.promise : projectTwoInstruction.promise,
      })
    );

    activeProjectId.value = "project-2";
    await nextTick();

    projectTwoInstruction.resolve(createInstruction("project-2", "Project two rules"));
    projectTwoDocuments.resolve([createDocument({ id: "document-2", projectId: "project-2" })]);
    await flushPromises();

    projectOneInstruction.resolve(createInstruction("project-1", "Stale project rules"));
    projectOneDocuments.resolve([createDocument({ id: "document-1", projectId: "project-1" })]);
    await flushPromises();

    assert.equal(knowledge.projectInstruction.value?.projectId, "project-2");
    assert.deepEqual(
      knowledge.projectDocuments.value.map((document) => document.id),
      ["document-2"]
    );
    assert.equal(knowledge.isLoadingInstruction.value, false);
    assert.equal(knowledge.isLoadingDocuments.value, false);
  });

  it("updates project knowledge through one state boundary", async () => {
    const activeProjectId = ref<string | null>("project-1");
    const knowledge = useProjectKnowledge(activeProjectId, createDependencies());

    await flushPromises();
    await knowledge.saveProjectInstruction("Use risk-based testing.");
    await knowledge.addProjectDocument({
      content: "# Checkout rules",
      mimeType: "text/markdown",
      title: "Checkout rules",
    });

    assert.equal(knowledge.projectInstruction.value?.content, "Use risk-based testing.");
    assert.equal(knowledge.projectDocuments.value[0]?.title, "Checkout rules");

    await knowledge.removeProjectDocument("document-created");

    assert.deepEqual(knowledge.projectDocuments.value, []);
  });

  it("best-effort releases uploaded source assets when project import fails", async () => {
    const cancelled: string[] = [];
    const activeProjectId = ref<string | null>("project-1");
    const knowledge = useProjectKnowledge(activeProjectId, createDependencies({
      async cancelPreparedFiles(files) {
        cancelled.push(...files.flatMap((file) => "sourceAssetId" in file ? [file.sourceAssetId] : []));
      },
      async importDocuments() {
        throw new Error("Import failed");
      },
      async prepareFiles() {
        return [{ sourceAssetId: "asset-source-1" }];
      },
    }));

    await flushPromises();
    await knowledge.importProjectFiles([{} as File]);

    assert.deepEqual(cancelled, ["asset-source-1"]);
    assert.equal(knowledge.documentErrorMessage.value, "Import failed");
  });
});

function createDependencies(
  overrides: Partial<ProjectKnowledgeDependencies> = {}
): ProjectKnowledgeDependencies {
  const dependencies: ProjectKnowledgeDependencies = {
    async cancelPreparedFiles() {},
    async createDocument(projectId, input) {
      return createDocument({
        content: input.content,
        id: "document-created",
        mimeType: input.mimeType || null,
        projectId,
        title: input.title,
      });
    },
    async deleteDocument() {},
    async fetchDocuments() {
      return [];
    },
    async fetchInstruction() {
      return null;
    },
    async importDocuments() {
      return [];
    },
    async prepareFiles() {
      return [];
    },
    async saveInstruction(projectId, content) {
      return createInstruction(projectId, content);
    },
    async updateDocument(projectId, documentId, input) {
      return createDocument({
        content: input.content,
        id: documentId,
        projectId,
        title: input.title,
      });
    },
  };

  return {
    ...dependencies,
    ...overrides,
  };
}

function createDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
    mimeType: "text/markdown",
    metadata: null,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    ...overrides,
  };
}

function createInstruction(projectId: string, content: string): ProjectInstruction {
  return {
    projectId,
    content,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
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
