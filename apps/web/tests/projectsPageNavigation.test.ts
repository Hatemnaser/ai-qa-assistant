import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import * as i18n from "../src/i18n/useI18n";
import type { Project } from "../src/features/projects/types";
import * as sessionList from "../src/features/sessions/sessionListPresentation";

interface ProjectPageState {
  activeProjectId: vue.Ref<string | null>;
  activeProject: vue.ComputedRef<Project | null>;
  isAddChatsModalOpen: vue.Ref<boolean>;
  isIntegrationsOpen: vue.Ref<boolean>;
  isAddingChats: vue.Ref<boolean>;
  addChatsErrorMessage: vue.Ref<string>;
  isProjectModalOpen: vue.Ref<boolean>;
  projectPendingDelete: vue.Ref<Project | null>;
  projectPendingExport: vue.Ref<Project | null>;
  projectToEdit: vue.Ref<Project | null>;
  isSaving: vue.Ref<boolean>;
  isExportingProject: vue.Ref<boolean>;
  openProject(project: Project): void;
  openAddChatsModal(): void;
  addChatsToActiveProject(ids: string[]): Promise<void>;
  openEditProjectModal(project: Project): void;
  openProjectExportModal(project: Project): void;
  requestRemoveProject(project: Project): void;
}

const source = await readFile(new URL("../src/features/projects/ProjectsPage.vue", import.meta.url), "utf8");
const script = transpileModule(compileScript(parse(source).descriptor, { id: "project-navigation-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;

describe("ProjectsPage owner-driven navigation", () => {
  it("closes integrations on project/account changes without resetting the project draft controller", async () => {
    const { state, props, dispose } = mountProjectPage();
    try {
      state.openProject(props.projects[0]!); await vue.nextTick();
      state.isIntegrationsOpen.value = true;
      props.projectToOpenId = null; await vue.nextTick();
      assert.equal(state.isIntegrationsOpen.value, false);
      state.openProject(props.projects[0]!); await vue.nextTick();
      state.isIntegrationsOpen.value = true;
      props.currentUser = { id: "owner-2" };
      assert.equal(state.isIntegrationsOpen.value, false);
    } finally { dispose(); }
  });
  it("waits for Add chats, prevents duplicate submissions, and preserves the dialog on failure", async () => {
    let reject!: (reason: Error) => void;
    let calls = 0;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const { state, props, dispose } = mountProjectPage({ addChatsToProject: async () => { calls++; await pending; } });
    try {
      state.openProject(props.projects[0]!); await vue.nextTick();
      state.openAddChatsModal();
      const adding = state.addChatsToActiveProject(["chat-1"]);
      assert.equal(state.isAddingChats.value, true);
      assert.equal(state.isAddChatsModalOpen.value, true);
      await state.addChatsToActiveProject(["chat-1"]);
      assert.equal(calls, 1);
      reject(new Error("Move conflict")); await adding;
      assert.equal(state.isAddingChats.value, false);
      assert.equal(state.isAddChatsModalOpen.value, true);
      assert.equal(state.addChatsErrorMessage.value, "Move conflict");
      props.addChatsToProject = async () => {};
      await state.addChatsToActiveProject(["chat-1"]);
      assert.equal(state.isAddChatsModalOpen.value, false);
    } finally { dispose(); }
  });

  it("ignores an old owner's failed Add chats completion after switching accounts", async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const { state, props, dispose } = mountProjectPage({ addChatsToProject: () => pending });
    try {
      state.openProject(props.projects[0]!); await vue.nextTick(); state.openAddChatsModal();
      const adding = state.addChatsToActiveProject(["chat-1"]);
      props.currentUser = { id: "owner-2" };
      assert.equal(state.isAddChatsModalOpen.value, false);
      reject(new Error("Private old error")); await adding;
      assert.equal(state.addChatsErrorMessage.value, "");
      assert.equal(state.isAddingChats.value, false);
    } finally { dispose(); }
  });
  it("returns from a project to the index when the owner clears projectToOpenId on the same route", async () => {
    const { state, props, emitted, dispose } = mountProjectPage();
    try {
      state.openProject(props.projects[0]!);
      await vue.nextTick();
      assert.equal(state.activeProject.value?.id, "project-1");
      state.openAddChatsModal();
      const previousEvents = emitted.length;

      props.projectToOpenId = null;
      await vue.nextTick();

      assert.equal(state.activeProjectId.value, null);
      assert.equal(state.activeProject.value, null);
      assert.equal(state.isAddChatsModalOpen.value, false);
      assert.equal(emitted.length, previousEvents, "Owner input must not emit a redundant selection event");

      state.openProject(props.projects[0]!);
      await vue.nextTick();
      assert.deepEqual(state.activeProject.value, props.projects[0], "A card can reopen the project after returning to the index");
    } finally { dispose(); }
  });

  it("clears detail-scoped confirmations without resetting in-flight write flags", async () => {
    const { state, props, dispose } = mountProjectPage();
    try {
      const project = props.projects[0]!;
      state.openProject(project);
      await vue.nextTick();
      state.openEditProjectModal(project);
      state.openProjectExportModal(project);
      state.requestRemoveProject(project);
      state.isSaving.value = true;
      state.isExportingProject.value = true;

      props.projectToOpenId = null;
      await vue.nextTick();

      assert.equal(state.isProjectModalOpen.value, false);
      assert.equal(state.projectToEdit.value, null);
      assert.equal(state.projectPendingDelete.value, null);
      assert.equal(state.projectPendingExport.value, null);
      assert.equal(state.isSaving.value, true);
      assert.equal(state.isExportingProject.value, true);
    } finally { dispose(); }
  });
});

function mountProjectPage(options: { addChatsToProject?: (ids: string[], projectId: string) => Promise<void> } = {}) {
  const module = { exports: {} as { default?: { setup(props: unknown, context: unknown): ProjectPageState } } };
  const imports: Record<string, unknown> = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {}, onDeactivated: () => {}, useId: () => "test-project-menu" },
    "../../i18n/useI18n": i18n,
    "../sessions/sessionListPresentation": sessionList,
    "./projectPortabilityDownload": {}, "./projectPortabilityApi": {}, "./projectPortabilityFlow": {}, "./projectsApi": {},
  };
  new Function("require", "exports", script)((id: string) => {
    if (id.endsWith(".vue")) return {};
    assert.ok(id in imports, `Unexpected project dependency: ${id}`);
    return imports[id];
  }, module.exports);
  const props = vue.reactive({
    projectToOpenId: null as string | null,
    currentUser: { id: "owner-1" },
    projects: [{ id: "project-1", name: "Project", description: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }] as Project[],
    chats: [], isLoadingProjects: false, isSending: false, message: "", mode: "", selectedAttachments: [],
    addChatsToProject: options.addChatsToProject,
  });
  const emitted: Array<[string, unknown]> = [];
  const scope = vue.effectScope();
  const state = scope.run(() => module.exports.default!.setup(props, {
    expose: () => {},
    emit: (name: string, value: unknown) => {
      emitted.push([name, value]);
      if (name === "active-project-changed") props.projectToOpenId = value as string | null;
    },
  }))!;
  return { state, props, emitted, dispose: () => scope.stop() };
}
