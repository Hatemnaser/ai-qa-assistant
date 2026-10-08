import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import { createChat } from "../src/features/chat/chatStorage";
import type { Chat } from "../src/features/chat/types";
import { partitionSessionList } from "../src/features/sessions/sessionListPresentation";
import * as i18n from "../src/i18n/useI18n";

const source = await readFile(new URL("../src/features/chat/components/ChatSidebar.vue", import.meta.url), "utf8");
const conversationSource = await readFile(new URL("../src/features/chat/components/ConversationSidebarContent.vue", import.meta.url), "utf8");
const descriptor = parse(conversationSource).descriptor;
const compiled = transpileModule(compileScript(descriptor, { id: "sidebar-navigation-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const shellCompiled = transpileModule(compileScript(parse(source).descriptor, { id: "shell" }).content, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
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
  workView?: "conversations" | "tests";
  testSessions?: { id: string; projectId: string; title: string; archivedAt?: string | null }[];
  tests?: { id: string; projectId: string; title: string; archivedAt?: string | null }[];
  activeTestId?: string | null;
  projectLoadError?: string;
};
type SidebarState = {
  areProjectsOpen: vue.Ref<boolean>;
  areArchivedOpen: vue.Ref<boolean>;
  isMobileOpen: vue.Ref<boolean>;
  recentSessions: vue.ComputedRef<{ id: string }[]>;
  archivedSessions: vue.ComputedRef<{ id: string }[]>;
  unavailableProjectGroups: vue.ComputedRef<{ projectId: string; active: { id: string }[] }[]>;
  getProjectSessions(id: string): { id: string }[];
  toggleProject(id: string): void;
  isProjectExpanded(id: string): boolean;
  isProjectActive(id: string): boolean;
  navigate(action: () => void): void;
};

function mountSidebar(overrides: Partial<SidebarProps> = {}, shell = false) {
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
    "../../sessions/sessionListPresentation": { partitionSessionList },
  };
  const exports = {} as { default: { setup(props: SidebarProps, ctx: unknown): SidebarState } };
  new Function("require", "exports", shell ? shellCompiled : compiled)((id: string) => {
    if (id.endsWith(".vue")) return {};
    assert.ok(id in modules, `Unexpected sidebar dependency: ${id}`);
    return modules[id];
  }, exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit() {} }))!;
  return { state, props };
}

describe("simplified sidebar preserves project and chat discovery", () => {
  it("closes the mobile drawer on session selection with one mixed project tree", async () => {
    const { state, props } = mountSidebar({ workView: "tests" }, true);
    state.isMobileOpen.value = true;
    props.activeTestId = "test";
    await vue.nextTick();
    assert.equal(state.isMobileOpen.value, false);
    assert.match(source, /<ConversationSidebarContent/);
    assert.doesNotMatch(source, /<TestSidebarContent/);
    assert.doesNotMatch(source, /<select :value="isTestsView/);
  });
  it("keeps project sessions out of Recent independent of folder disclosure", () => {
    const chats = [createChat({ id: "standalone" }), createChat({ id: "project-chat", projectId: "one" }), createChat({ id: "missing-project-chat", projectId: "removed" })];
    const { state } = mountSidebar({ chats, projects: [{ id: "one", name: "Checkout" }] });
    assert.deepEqual(state.recentSessions.value.map(item => item.id), ["standalone"]);
    assert.deepEqual(state.getProjectSessions("one").map(item => item.id), ["project-chat"]);
    assert.deepEqual(state.unavailableProjectGroups.value[0]?.active.map(item => item.id), ["missing-project-chat"]);
    state.toggleProject("one");
    assert.deepEqual(state.recentSessions.value.map(item => item.id), ["standalone"]);
    state.areProjectsOpen.value = false;
    assert.equal(state.recentSessions.value.length, 1);
    state.areProjectsOpen.value = true;
    state.toggleProject("one");
    assert.equal(state.recentSessions.value.length, 1);
  });

  it("expands an active project's chats and marks the project page independently", async () => {
    const { state, props } = mountSidebar({ projects: [{ id: "one", name: "Checkout" }], chats: [createChat({ id: "first", projectId: "one" })] });
    props.activeChatId = "first";
    props.isChatRoute = true;
    await vue.nextTick();
    assert.equal(state.isProjectExpanded("one"), true);
    assert.equal(state.recentSessions.value.length, 0);
    props.isChatRoute = false;
    props.isProjectsRoute = true;
    props.activeProjectId = "one";
    await vue.nextTick();
    assert.equal(state.isProjectActive("one"), true);
  });

  it("groups chat and Test sessions under one project without a QA-only filter", () => {
    const { state } = mountSidebar({ projects: [{ id: "one", name: "Checkout" }],
      chats: [createChat({ id: "discussion", projectId: "one" })],
      tests: [{ id: "qa-session", projectId: "one", title: "Checkout QA", archivedAt: null }] });
    assert.deepEqual(state.recentSessions.value, []);
    assert.deepEqual(new Set(state.getProjectSessions("one").map(item => item.id)), new Set(["discussion", "qa-session"]));
    state.toggleProject("one");
    assert.deepEqual(state.recentSessions.value, []);
    assert.match(conversationSource, /:entries="group.active"/);
    assert.match(conversationSource, /<SidebarSessionList/);
    assert.match(conversationSource, /emit\('select-test', item\)/);
  });

  it("preserves a manually collapsed active project during index updates", async () => {
    const { state, props } = mountSidebar({
      projects: [{ id: "one", name: "Checkout" }],
      isWorkspaceRoute: true, activeTestId: "active",
      tests: [{ id: "active", projectId: "one", title: "Checkout QA" }],
    });
    assert.equal(state.isProjectExpanded("one"), true);
    state.toggleProject("one");
    state.areProjectsOpen.value = false;
    props.tests = [{ id: "active", projectId: "one", title: "Updated QA" }];
    await vue.nextTick();
    assert.equal(state.isProjectExpanded("one"), false);
    assert.equal(state.areProjectsOpen.value, false);
    props.tests = [{ id: "active", projectId: "one", title: "Updated QA" }, { id: "next", projectId: "one", title: "Next" }];
    await vue.nextTick();
    assert.equal(state.isProjectExpanded("one"), false);
    props.activeTestId = "next";
    await vue.nextTick();
    assert.equal(state.isProjectExpanded("one"), true);
    assert.equal(state.areProjectsOpen.value, true);
  });

  it("does not reopen standalone archive for unchanged active identity on refresh", async () => {
    const { state, props } = mountSidebar({ isWorkspaceRoute: true, activeTestId: "archived",
      tests: [{ id: "archived", projectId: "", title: "Old QA", archivedAt: "2026-10-04" }] });
    assert.equal(state.areArchivedOpen.value, true);
    state.areArchivedOpen.value = false;
    props.tests = [{ id: "archived", projectId: "", title: "Renamed QA", archivedAt: "2026-10-04" }];
    await vue.nextTick();
    assert.equal(state.areArchivedOpen.value, false);
  });

  it("closes mobile navigation on an explicit action or account change", async () => {
    const { state, props } = mountSidebar({}, true);
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
    assert.doesNotMatch(conversationSource, /v-if="projects.length > 0"/);
    assert.match(conversationSource, /sidebar\.nav\.newProject/);
    assert.match(conversationSource, /navigate\(\(\) => emit\('open-project', group\.project\.id\)\)/);
    assert.match(conversationSource, /@click\.stop="toggleProject\(group\.project\.id\)"/);
    assert.match(source, /emit\('open-home'\)/);
    assert.doesNotMatch(source, /sidebar\.nav\.(qaChat|allProjects)/);
    assert.match(source, /useDialogAccessibility\(\{/);
    assert.doesNotMatch(conversationSource, /:project-name=/);
    for (const event of ["export-active-chat", "import-chat", "open-settings", "open-usage", "toggle-theme", "open-chat-menu", "rename-chat", "cancel-rename"]) {
      assert.ok(source.includes(`emit('${event}'`), `${event} remains wired`);
    }
  });
  it("retains an unavailable project's rows on read failure without treating them as standalone", async () => {
    const { state, props } = mountSidebar({ tests: [{ id: "managed", projectId: "pending", title: "QA" }], projectLoadError: "offline" });
    assert.deepEqual(state.recentSessions.value, []);
    assert.equal(state.unavailableProjectGroups.value[0]?.projectId, "pending");
    props.projects = [{ id: "pending", name: "Recovered" }];
    props.projectLoadError = "";
    await vue.nextTick();
    assert.deepEqual(state.unavailableProjectGroups.value, []);
    assert.deepEqual(state.getProjectSessions("pending").map(item => item.id), ["managed"]);
    assert.deepEqual(state.recentSessions.value, []);
  });
  it("has one rail account menu, real destinations and no public quota chips", async () => {
    const account = await readFile(new URL("../src/features/chat/components/SidebarAccountMenu.vue", import.meta.url), "utf8");
    const topbar = await readFile(new URL("../src/features/chat/components/ChatTopbar.vue", import.meta.url), "utf8");
    assert.equal((source.match(/<SidebarAccountMenu\b/g) || []).length, 1);
    assert.match(source, /workspace-navigation__rail/);
    assert.match(source, /sessionTools.navigation.sessions/);
    assert.match(source, /sessionTools.navigation.projects/);
    assert.doesNotMatch(account, /sidebar-account-credit/);
    assert.doesNotMatch(topbar, /topbar-status--quota/);
    assert.match(account, /<ul[^>]*sidebar-account-menu[\s\S]*usageSummary.remaining/);
    assert.match(account, /:value="usageSummary.used" :max="usageSummary.limit"/);
    assert.match(account, /emit\('reload-usage'\)/);
    assert.doesNotMatch(account, /resetsAt|5h|Weekly/);
  });
});
