import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { messages } from "../src/i18n/messages/index.ts";
import {
  refreshAndOpenImportedProject,
  useProjectImportFlow,
} from "../src/features/projects/projectPortabilityFlow.ts";
import type {
  ProjectImportCommitResult,
  ProjectImportPreview,
} from "../src/features/projects/projectPortabilityApi.ts";
import type { Project } from "../src/features/projects/types.ts";

describe("project portability flow", () => {
  it("keeps commit disabled until preview succeeds and exposes preview details", async () => {
    const file = createZipFile("project.zip");
    const preview = createPreview();
    const flow = useProjectImportFlow({
      async commit() {
        throw new Error("Commit should not run during preview.");
      },
      async preview(receivedFile) {
        assert.equal(receivedFile, file);
        return preview;
      },
    });

    assert.equal(flow.canCommit.value, false);

    flow.selectFile(file);
    assert.equal(flow.canCommit.value, false);

    await flow.previewSelectedFile();

    assert.equal(flow.canCommit.value, true);
    assert.equal(flow.preview.value?.suggestedProjectName, "Checkout QA (Imported)");
    assert.deepEqual(flow.preview.value?.counts, preview.counts);
    assert.deepEqual(flow.preview.value?.warnings, preview.warnings);
    assert.deepEqual(flow.preview.value?.unsupported, preview.unsupported);
  });

  it("commits the exact previewed file with its digest", async () => {
    const file = createZipFile("project.zip");
    const calls: Array<{ file: File; digest: string }> = [];
    const flow = useProjectImportFlow({
      async commit(receivedFile, digest) {
        calls.push({
          file: receivedFile,
          digest,
        });
        return createCommitResult();
      },
      async preview() {
        return createPreview();
      },
    });

    flow.selectFile(file);
    await flow.previewSelectedFile();
    const result = await flow.commitSelectedFile();

    assert.equal(result?.projectId, "imported-project-1");
    assert.deepEqual(calls, [
      {
        file,
        digest: "digest-123",
      },
    ]);
  });

  it("clears preview and digest state when a different file is selected", async () => {
    const flow = useProjectImportFlow({
      async commit() {
        return createCommitResult();
      },
      async preview() {
        return createPreview();
      },
    });

    flow.selectFile(createZipFile("first.zip"));
    await flow.previewSelectedFile();
    assert.equal(flow.canCommit.value, true);

    flow.selectFile(createZipFile("second.zip"));

    assert.equal(flow.preview.value, null);
    assert.equal(flow.canCommit.value, false);
  });

  it("shows a safe preview error and blocks commit", async () => {
    const flow = useProjectImportFlow({
      async commit() {
        throw new Error("Commit must remain blocked.");
      },
      async preview() {
        throw new Error("This ZIP is invalid or unsupported.");
      },
    });

    flow.selectFile(createZipFile("invalid.zip"));
    await flow.previewSelectedFile();

    assert.equal(flow.errorMessage.value, "This ZIP is invalid or unsupported.");
    assert.equal(flow.preview.value, null);
    assert.equal(flow.canCommit.value, false);
    assert.equal(await flow.commitSelectedFile(), null);
  });

  it("refreshes projects and chats before opening the imported project after commit", async () => {
    const projects = [
      createProject({
        id: "imported-project-1",
        name: "Checkout QA (Imported)",
      }),
    ];
    let refreshCalls = 0;
    let openedProjectId = "";
    const events: string[] = [];

    const refreshed = await refreshAndOpenImportedProject(createCommitResult(), {
      openProject(project) {
        events.push("open-project");
        openedProjectId = project.id;
      },
      async refreshChats() {
        events.push("refresh-chats");
      },
      async refreshProjects() {
        events.push("refresh-projects");
        refreshCalls += 1;
        return projects;
      },
    });

    assert.equal(refreshCalls, 1);
    assert.equal(openedProjectId, "imported-project-1");
    assert.deepEqual(events, [
      "refresh-projects",
      "refresh-chats",
      "open-project",
    ]);
    assert.deepEqual(refreshed, projects);
  });

  it("keeps project portability translations in every supported locale", () => {
    const keys = [
      "projects.portability.export.action",
      "projects.portability.export.includeChats",
      "projects.portability.import.action",
      "projects.portability.import.preview",
      "projects.portability.import.create",
      "projects.portability.import.success",
    ] as const;

    for (const locale of ["en", "ar", "de"] as const) {
      for (const key of keys) {
        assert.ok(messages[locale][key], `${locale}.${key} must exist`);
      }
    }
  });
});

function createPreview(): ProjectImportPreview {
  return {
    compatible: true,
    formatVersion: "1.0",
    exportType: "project",
    packageDigest: "digest-123",
    suggestedProjectName: "Checkout QA (Imported)",
    sourceProjectName: "Checkout QA",
    counts: {
      documents: 2,
      chats: 3,
      messages: 8,
    },
    warnings: ["Attachment files are unavailable."],
    unsupported: ["notes.txt"],
  };
}

function createCommitResult(): ProjectImportCommitResult {
  return {
    projectId: "imported-project-1",
    projectName: "Checkout QA (Imported)",
    imported: {
      documents: 2,
      chats: 3,
      messages: 8,
    },
    warnings: [],
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Checkout QA",
    description: null,
    role: "OWNER",
    createdAt: "2026-06-24T12:00:00.000Z",
    updatedAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}

function createZipFile(name: string) {
  return new File(["project-zip"], name, {
    type: "application/zip",
  });
}
