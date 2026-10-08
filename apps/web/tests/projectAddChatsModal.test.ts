import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import * as sessionList from "../src/features/sessions/sessionListPresentation";
import * as projectDate from "../src/features/projects/projectDate";
import type { SidebarTestItem } from "../src/features/test-sessions/navigation";

const source = await readFile(new URL("../src/features/projects/components/ProjectAddChatsModal.vue", import.meta.url), "utf8");
const compiled = transpileModule(compileScript(parse(source).descriptor, { id: "project-add-chats-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;
const row = (id: string, projectId = ""): SidebarTestItem => ({ id, title: id, projectId, updatedAt: "2026-10-05T10:00:00Z", requestIds: [] });
interface ModalState {
  availableChats: vue.ComputedRef<sessionList.SessionListEntry[]>;
  selectedChatIds: vue.Ref<Set<string>>;
  canAdd: vue.ComputedRef<boolean>;
  toggleChat(id: string): void;
  selectVisibleChats(): void;
  addSelectedChats(): void;
  requestCancel(): void;
}
function mount() {
  const modules: Record<string, unknown> = {
    vue,
    "../../../i18n/useI18n": { useI18n: () => ({ t: (key: string) => key }) },
    "../../../ui/useDialogAccessibility": { useDialogAccessibility: () => ({ dialogRef: vue.ref(null), onDialogKeydown: () => {} }) },
    "../../sessions/sessionListPresentation": sessionList,
    "../projectDate": projectDate,
  };
  const exports = {} as { default: { setup(props: unknown, context: unknown): ModalState } };
  new Function("require", "exports", compiled)((id: string) => {
    if (id.endsWith(".vue")) return {};
    assert.ok(id in modules, `Unexpected modal dependency: ${id}`);
    return modules[id];
  }, exports);
  const props = vue.reactive({ chats: [], sessions: [row("standalone"), row("other", "project-b")],
    project: { id: "project-a" }, isOpen: true, isSaving: false, isLoading: false, loadError: "", errorMessage: "" });
  const emitted: Array<[string, unknown]> = [];
  const scope = vue.effectScope();
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit: (name: string, value?: unknown) => emitted.push([name, value]) }))!;
  return { state, props, emitted, dispose: () => scope.stop() };
}

describe("Project Add chats unified candidates and recovery", () => {
  it("lists signed-in sessions even with no legacy chats and preserves failed selections while pruning successful moves", async () => {
    const { state, props, emitted, dispose } = mount();
    try {
      assert.deepEqual(state.availableChats.value.map(item => item.id), ["standalone", "other"]);
      state.selectVisibleChats(); state.addSelectedChats();
      assert.deepEqual(emitted, [["add", ["standalone", "other"]]]);
      props.errorMessage = "Other move failed";
      props.sessions = [row("standalone", "project-a"), row("other", "project-b")];
      await vue.nextTick();
      assert.deepEqual([...state.selectedChatIds.value], ["other"]);
      assert.equal(state.canAdd.value, true);
      state.addSelectedChats();
      assert.deepEqual(emitted.at(-1), ["add", ["other"]]);
    } finally { dispose(); }
  });

  it("retains cached rows on read errors, blocks stale submissions, and resumes the same selection after retry", async () => {
    const { state, props, emitted, dispose } = mount();
    try {
      state.toggleChat("other"); props.loadError = "Temporary read failure";
      await vue.nextTick();
      assert.equal(state.availableChats.value.length, 2);
      assert.deepEqual([...state.selectedChatIds.value], ["other"]);
      assert.equal(state.canAdd.value, false);
      state.addSelectedChats(); assert.equal(emitted.length, 0);
      props.loadError = ""; props.isLoading = true;
      assert.equal(state.canAdd.value, false);
      props.isLoading = false;
      assert.equal(state.canAdd.value, true);
      state.addSelectedChats(); assert.deepEqual(emitted, [["add", ["other"]]]);
    } finally { dispose(); }
  });

  it("does not resubmit, clear selection, or close the dialog during a pending write", () => {
    const { state, props, emitted, dispose } = mount();
    try {
      state.toggleChat("other"); props.isSaving = true;
      state.toggleChat("other"); state.selectVisibleChats(); state.addSelectedChats(); state.requestCancel();
      assert.deepEqual([...state.selectedChatIds.value], ["other"]);
      assert.equal(state.canAdd.value, false);
      assert.deepEqual(emitted, []);
      assert.match(source, /canClose: \(\) => !props\.isSaving/);
      assert.match(source, /@click="emit\('retry'\)"/);
    } finally { dispose(); }
  });
});
