import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import { createChat } from "../src/features/chat/chatStorage";
import type { Chat } from "../src/features/chat/types";
import * as i18n from "../src/i18n/useI18n";

const source = await readFile(new URL("../src/features/chat/components/ChatSidebar.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const compiled = transpileModule(compileScript(descriptor, { id: "sidebar-navigation-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const scopes: vue.EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

type SidebarProps = {
  activeChatId: string | null;
  activeProjectId: string | null;
  chats: Chat[];
  currentUser: { id: string } | null;
  isHomeRoute: boolean;
  isChatRoute: boolean;
  isProjectsRoute: boolean;
  isWorkspaceRoute: boolean;
  projects: { id: string; name: string }[];
  renamingChatId: string | null;
  themeToggleLabel: string;
};
type SidebarState = {
  areProjectsOpen: vue.Ref<boolean>;
  isMobileOpen: vue.Ref<boolean>;
  recentChats: vue.ComputedRef<Chat[]>;
  projectNames: vue.ComputedRef<Map<string, string>>;
  toggleProject(id: string): void;
  isProjectExpanded(id: string): boolean;
  isProjectActive(id: string): boolean;
  navigate(action: () => void): void;
};

function mountSidebar(overrides: Partial<SidebarProps> = {}) {
  const props = vue.reactive<SidebarProps>({
    activeChatId: null, activeProjectId: null, chats: [], currentUser: null,
    isHomeRoute: true, isChatRoute: false, isProjectsRoute: false, isWorkspaceRoute: false,
    projects: [], renamingChatId: null, themeToggleLabel: "Dark", ...overrides,
  });
  const modules: Record<string, unknown> = {
    vue: { ...vue, onMounted: () => {}, onBeforeUnmount: () => {} },
    "../../../i18n/useI18n": i18n,
    "../../../ui/useDialogAccessibility": { useDialogAccessibility: () => ({ dialogRef: vue.ref(null), onDialogKeydown() {} }) },
    "../../../ui/Icon.vue": {}, "./SidebarAccountMenu.vue": {}, "./SidebarChatItem.vue": {}, "./SidebarNavItem.vue": {},
  };
  const exports = {} as { default: { setup(props: SidebarProps, ctx: unknown): SidebarState } };
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in modules, `Unexpected sidebar dependency: ${id}`);
    return modules[id];
  }, exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit() {} }))!;
  return { state, props };
}

describe("simplified sidebar preserves project and chat discovery", () => {
  it("shows all recent chats until their project's chats are expanded", () => {
    const chats = [createChat({ id: "standalone" }), createChat({ id: "project-chat", projectId: "one" }), createChat({ id: "missing-project-chat", projectId: "removed" })];
    const { state } = mountSidebar({ chats, projects: [{ id: "one", name: "Checkout" }] });
    assert.deepEqual(state.recentChats.value.map((chat) => chat.id), chats.map((chat) => chat.id));
    assert.equal(state.projectNames.value.get("one"), "Checkout");
    state.toggleProject("one");
    assert.deepEqual(state.recentChats.value.map((chat) => chat.id), ["standalone", "missing-project-chat"]);
    state.areProjectsOpen.value = false;
    assert.equal(state.recentChats.value.length, 3);
    state.areProjectsOpen.value = true;
    state.toggleProject("one");
    assert.equal(state.recentChats.value.length, 3);
  });

  it("expands an active project's chats and marks the project page independently", async () => {
    const { state, props } = mountSidebar({ projects: [{ id: "one", name: "Checkout" }], chats: [createChat({ id: "first", projectId: "one" })] });
    props.activeChatId = "first";
    props.isChatRoute = true;
    await vue.nextTick();
    assert.equal(state.isProjectExpanded("one"), true);
    assert.equal(state.recentChats.value.length, 0);
    props.isChatRoute = false;
    props.isProjectsRoute = true;
    props.activeProjectId = "one";
    await vue.nextTick();
    assert.equal(state.isProjectActive("one"), true);
  });

  it("closes mobile navigation on an explicit action or account change", async () => {
    const { state, props } = mountSidebar();
    state.isMobileOpen.value = true;
    let navigations = 0;
    state.navigate(() => { navigations += 1; });
    assert.equal(state.isMobileOpen.value, false);
    assert.equal(navigations, 1);
    state.isMobileOpen.value = true;
    props.currentUser = { id: "next-account" };
    await vue.nextTick();
    assert.equal(state.isMobileOpen.value, false);
  });

  it("keeps New Project available with no projects and separates open-page from fold", () => {
    assert.doesNotMatch(source, /v-if="projects.length > 0"/);
    assert.match(source, /sidebar\.nav\.newProject/);
    assert.match(source, /navigate\(\(\) => emit\('open-project', project\.id\)\)/);
    assert.match(source, /@click\.stop="toggleProject\(project\.id\)"/);
    assert.match(source, /emit\('open-home'\)/);
    assert.doesNotMatch(source, /sidebar\.nav\.(qaChat|allProjects)/);
    assert.match(source, /useDialogAccessibility\(\{/);
    assert.match(source, /:project-name="chat.projectId \? projectNames.get\(chat.projectId\)/);
    for (const event of ["export-active-chat", "import-chat", "open-settings", "open-usage", "toggle-theme", "open-chat-menu", "rename-chat", "cancel-rename"]) {
      assert.ok(source.includes(`emit('${event}'`), `${event} remains wired`);
    }
  });
});
