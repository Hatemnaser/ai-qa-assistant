import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

function source(path: string) {
  return readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
}

describe("workspace dialog presentation boundaries", () => {
  it("places the workspace scope on each teleported project/chat dialog root", async () => {
    const paths = [
      "chat/components/ChatDeleteModal.vue",
      "chat/components/GuestLimitModal.vue",
      "projects/components/ProjectAddChatsModal.vue",
      "projects/components/ProjectDeleteModal.vue",
      "projects/components/ProjectExportModal.vue",
      "projects/components/ProjectFormModal.vue",
      "projects/components/ProjectImportModal.vue",
      "projects/components/ProjectIntegrationsDialog.vue",
      "project-instructions/components/ProjectInstructionModal.vue",
      "project-memory/components/ProjectMemoryModal.vue",
      "project-documents/components/ProjectDocumentsModal.vue",
      "project-documents/components/ProjectDocumentTextModal.vue",
      "project-documents/components/ProjectDocumentPreviewModal.vue",
    ];
    for (const path of paths) {
      const text = await source(`features/${path}`);
      assert.match(text, /<Teleport to="body">\s*<div\s[^>]*class="workspace-surface modal /, path);
      assert.match(text, /role="dialog"/, path);
      assert.match(text, /aria-modal="true"/, path);
      assert.match(text, /@keydown="onDialogKeydown"/, path);
      assert.match(text, /class="modal-backdrop fade show"/, path);
    }
  });

  it("scopes all teleported context menus independently of their original parent", async () => {
    const chat = await source("features/chat/components/ChatContextMenus.vue");
    const projects = await source("features/projects/ProjectsPage.vue");
    assert.equal((chat.match(/class="workspace-surface chat-dropdown-menu/g) || []).length, 3);
    assert.match(projects, /class="workspace-surface chat-dropdown-menu show"/);
  });

  it("keeps the shared connection dialog's QA appearance unchanged unless explicitly requested", async () => {
    const [modal, integrations, workspace] = await Promise.all([
      source("features/qa/components/QaConnectionModal.vue"),
      source("features/projects/components/ProjectIntegrationsDialog.vue"),
      source("features/qa/QaWorkspacePage.vue"),
    ]);
    assert.match(modal, /appearance\?: "workspace";/);
    assert.match(modal, /:class="\{ 'workspace-surface': appearance === 'workspace' \}"/);
    assert.doesNotMatch(modal, /class="workspace-surface/);
    assert.match(integrations, /<QaConnectionModal\b[^>]*appearance="workspace"/);
    assert.doesNotMatch(workspace.match(/<QaConnectionModal\b[^>]*\/>/)?.[0] || "", /appearance=/);
    assert.match(integrations, /:inert="Boolean\(managing\)"/);
    assert.match(integrations, /:aria-hidden="managing \? 'true' : undefined"/);
  });
});
