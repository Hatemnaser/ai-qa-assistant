import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import * as lastWork from "../src/router/lastWork";
import * as sessionSources from "../src/features/sessions/sessionSources";
import type { TestSessionDetail } from "../src/features/test-sessions/types";
import { buildTestRoute, buildSessionRoute, buildProjectRoute, parseProjectRouteScope, parseAppRoute, parseTestRouteScope } from "../src/router/useAppRoute";

const source = await readFile(new URL("../src/App.vue", import.meta.url), "utf8");
const compiled = transpileModule(compileScript(parse(source).descriptor, { id: "test-session-shell" }).content, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const scopes: vue.EffectScope[] = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const project = { id: "p1", name: "Checkout" };
const session = { id: "s1", projectId: "p1", title: "Login", requestIds: ["r1"], currentRequestId: "r1", archivedAt: null };
const sessionDetail = (changes: Partial<TestSessionDetail> = {}): TestSessionDetail => ({
  ...session, version: 1, createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z',
  messages: [], pendingProposal: null, preparation: null, turnStatus: null,
  requests: [{ id: 'r1', projectId: 'p1', title: 'Login', objective: 'Check login', phase: 'APPROVED', version: 1,
    createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z' }], ...changes,
});
const missing = () => Object.assign(new Error('Not found'), { status: 404 });
const tick = async () => { for (let index = 0; index < 8; index += 1) await vue.nextTick(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

function mount(options: { hash?: string; index?: () => Promise<unknown>; projects?: Array<{ id: string; name: string }>;
  initialUser?: { id: string } | null; readUser?: () => Promise<{ id: string } | null>;
  readProjects?: () => Promise<Array<{ id: string; name: string }>>; usage?: () => Promise<unknown>;
  chat?: { id: string; projectId: string | null; updatedAt: string; messages: Array<{ id: string; content: string }> };
  serverChats?: Array<{ id: string; projectId: string | null; updatedAt: string; messages: Array<{ id: string; content: string }> }>;
  readSession?: (id: string) => Promise<TestSessionDetail>;
  readProject?: (id: string) => Promise<unknown>;
  readRequest?: (projectId: string, id: string) => Promise<{ id: string; projectId: string }>;
  moveSession?: (id: string, input: { projectId?: string | null; expectedSessionVersion: number; expectedUpdatedAt?: string }) => Promise<TestSessionDetail>;
  persist?: () => Promise<void>;
  activationFailure?: Error } = {}) {
  const storageData = new Map<string, string>();
  const storage = { getItem: (key: string) => storageData.get(key) || null, setItem: (key: string, value: string) => { storageData.set(key, value); } };
  let currentHash = options.hash || "";
  const location = { get hash() { return currentHash; }, set hash(value: string) { currentHash = value && !value.startsWith("#") ? `#${value}` : value; }, pathname: "/" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, localStorage: storage } });
  const currentRoute = vue.ref(parseAppRoute(location));
  const testScope = vue.ref(parseTestRouteScope(location.hash));
  const projectScope = vue.ref(parseProjectRouteScope(location.hash));
  const currentUser = vue.ref<{ id: string } | null>(options.initialUser === undefined ? { id: "owner-a" } : options.initialUser);
  const authLoading = vue.ref(Boolean(options.readUser));
  const authReadError = vue.ref(false);
  const calls: string[] = [];
  const navigate = (hash: string) => { location.hash = `#${hash}`; currentRoute.value = parseAppRoute(location); testScope.value = parseTestRouteScope(location.hash); projectScope.value = parseProjectRouteScope(location.hash); calls.push(`navigate:${hash}`); };
  const noop = () => {};
  const controller: Record<string, unknown> = {
    chats: vue.ref(options.chat ? [options.chat] : []), activeChat: vue.ref(options.chat || null), activeChatId: vue.ref(options.chat?.id || null), activeMessages: vue.ref([]), selectedProjectId: vue.ref(options.chat?.projectId || null),
    selectedAttachments: vue.ref([]), messageInput: vue.ref(""), selectedMode: vue.ref("CHAT"), selectedModel: vue.ref("model"), guestLimitReached: vue.ref(false), isSending: vue.ref(false),
    modelOptions: vue.ref([]), usageSummary: vue.ref(null), prepareNewChat: noop, prepareNewChatForProject: noop,
    handleSubmit: async () => { calls.push('POST guest chat'); },
    replaceChats: (next: unknown[]) => { (controller.chats as vue.Ref<unknown[]>).value = next; },
    assignChatProject: (id: string, projectId: string) => { calls.push(`local assign:${id}:${projectId}`); },
  };
  const declared = source.match(/const \{([\s\S]*?)\} = useChatController\(currentUser\);/)?.[1] || "";
  for (const key of declared.split(/[,\s]+/).filter((item) => /^\w+$/.test(item))) if (!(key in controller)) controller[key] = noop;
  const modules: Record<string, unknown> = {
    vue: { ...vue, onMounted: noop, defineAsyncComponent: () => ({}) },
    "./router/useAppRoute": { parseProjectRouteScope, parseTestRouteScope, useAppRoute: () => ({ currentRoute, testScope, projectScope, navigateToWorkspace: (scope = {}) => navigate(buildTestRoute(scope)), navigateToChat: (scope = {}) => navigate(buildSessionRoute(scope)), navigateToHome: () => navigate("/home"), navigateToProjects: (scope = {}) => navigate(buildProjectRoute(scope)), navigateToAuth: (view: string) => navigate(`/${view}`), navigateToSettings: noop, navigateToUsage: noop }) },
    "./router/lastWork": lastWork,
    "./features/auth/composables/useAuthSession": { useAuthSession: () => ({ currentUser, authLoading, authReadError,
      loadCurrentUser: async () => {
        authLoading.value = true; authReadError.value = false;
        try { if (options.readUser) currentUser.value = await options.readUser(); }
        catch { currentUser.value = null; authReadError.value = true; }
        finally { authLoading.value = false; }
        return currentUser.value;
      },
      clearCurrentUser: () => { currentUser.value = null; }, setAuthenticatedUser: (user: { id: string }) => { currentUser.value = user; }, logoutCurrentUser: noop }) },
    "./features/chat/composables/useChatController": { useChatController: () => controller },
    "./features/chat/composables/useAccountChatSync": { useAccountChatSync: () => ({ syncAccountChats: async () => {}, persistAccountChats: async () => { await options.persist?.(); }, clearScheduledChatPersist: noop, deletePersistedChat: noop }) },
    "./features/chat/chatTheme": { useTheme: () => ({ setTheme: noop, toggleTheme: noop, theme: vue.ref("dark"), themeToggleLabel: vue.ref("Light") }) },
    "./features/chat/chatStorage": { clearChats: noop, clearChatPendingUpsert: noop, getUserChatStorageScope: (id: string) => id, loadChatSyncState: () => ({ pendingCreates: [], pendingUpserts: [], pendingDeletes: [] }) },
    "./features/chat/chatPersistenceApi": { fetchAccountChats: async () => options.serverChats || [] },
    "./features/assets/assetsApi": { clearAssetDownloadUrlCache: noop },
    "./features/projects/projectsApi": { fetchProjects: async () => { calls.push("GET projects"); return options.readProjects ? options.readProjects() : options.projects || [project]; }, createProject: async () => { calls.push("POST project"); return project; } },
    "./features/project-instructions/projectInstructionsApi": { fetchProjectInstruction: async (id: string) => {
      calls.push(`GET project:${id}`);
      if (options.readProject) return options.readProject(id);
      if (!(options.projects || [project]).some(project => project.id === id)) throw missing();
      return null;
    } },
    "./features/qa/qaApi": { fetchQaRequest: async (projectId: string, id: string) => {
      calls.push(`GET request:${projectId}:${id}`);
      if (options.readRequest) return options.readRequest(projectId, id);
      if (projectId !== 'p1' || id !== 'r1') throw missing();
      return { id, projectId };
    } },
    "./features/settings/settingsApi": { fetchUserSettings: async () => ({ defaultModel: "model", language: "en", theme: "dark" }), updateUserSettings: async () => ({}) },
    "./features/sessions/sessionApi": {
      fetchSessionIndex: async () => { calls.push("GET tests"); return options.index ? options.index() : { sessions: [session], unlinkedRequests: [] }; },
      fetchTestSession: async (_projectId: string, id: string) => {
        calls.push(`GET session:${id}`);
        if (options.readSession) return options.readSession(id);
        if (id !== 's1') throw missing();
        return sessionDetail();
      },
      updateTestSession: async (_projectId: string, id: string, input: { projectId?: string | null; expectedSessionVersion: number; expectedUpdatedAt?: string }) => { calls.push(`PATCH session:${id}`); if (!options.moveSession) throw new Error('No move fixture'); return options.moveSession(id, input); },
    },
    "./features/sessions/sessionSources": sessionSources,
    "./features/sessions/sessionDraftRelocation": { createSessionDraftRelocator: () => ({
      checkProjectMove: async () => {}, applyProjectMove: async () => {}, dispose: noop,
    }) },
    "./features/usage/usageApi": { fetchUsageSummary: async () => options.usage ? options.usage() : ({ remaining: 20 }) },
    "./i18n/useI18n": { useI18n: () => ({ t: (key: string) => key, locale: vue.ref("en"), setLocale: noop }) },
  };
  const exports = {} as { default: { setup(props: unknown, context: unknown): Record<string, any> } };
  new Function("require", "exports", compiled)((id: string) => {
    if (id.endsWith(".vue")) return {};
    assert.ok(id in modules, `Unexpected dependency ${id}`);
    return modules[id];
  }, exports);
  const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))!;
  return { state, currentUser, currentRoute, testScope, storage, storageData, calls, navigate, location };
}

describe("conversational Tests shell", () => {
  it("does not expose or submit the guest composer while authentication is unresolved", async () => {
    const identity = deferred<{ id: string } | null>();
    const app = mount({ hash: '#/chat?sessionId=s1&projectId=p1', initialUser: null, readUser: () => identity.promise });
    assert.equal(app.state.authGateVisible.value, true);
    const startup = app.state.initializeSession();
    app.state.messageInput.value = 'Keep this within my saved session';
    await app.state.handleSubmit();
    app.state.handleHomeSubmit();
    app.state.handleProjectMessageSubmit('p1');
    assert.equal(app.calls.filter(call => call === 'POST guest chat').length, 0);
    assert.equal(app.location.hash, '#/chat?sessionId=s1&projectId=p1');
    identity.resolve({ id: 'owner-a' });
    await startup; await tick();
    assert.equal(app.state.authGateVisible.value, false);
    assert.equal(app.state.canSubmitGuestChat.value, false);
    await app.state.handleSubmit();
    assert.equal(app.calls.filter(call => call === 'POST guest chat').length, 0);
  });

  it("unlocks an unscoped guest composer only after identity resolution, including retry after read failure", async () => {
    let fail = true;
    const app = mount({ hash: '#/chat', initialUser: null, readUser: async () => { if (fail) throw new Error('offline'); return null; } });
    await app.state.initializeSession();
    assert.equal(app.state.authLoading.value, false);
    assert.equal(app.state.authReadError.value, true);
    assert.equal(app.state.authGateVisible.value, true);
    await app.state.handleSubmit();
    assert.equal(app.calls.filter(call => call === 'POST guest chat').length, 0);
    fail = false;
    await app.state.initializeSession();
    assert.equal(app.state.authGateVisible.value, false);
    assert.equal(app.state.canSubmitGuestChat.value, true);
    await app.state.handleSubmit();
    assert.equal(app.calls.filter(call => call === 'POST guest chat').length, 1);
  });

  it("preserves account-scoped links after a guest response instead of sending them through legacy chat", async () => {
    for (const hash of ['#/chat?sessionId=s1', '#/chat?projectId=p1', '#/tests?projectId=p1&requestId=r1', '#/projects?projectId=p1']) {
      const app = mount({ hash, initialUser: null, readUser: async () => null });
      await app.state.initializeSession(); await tick();
      assert.equal(app.state.authReadError.value, false);
      assert.equal(app.state.authGateVisible.value, true);
      await app.state.handleSubmit();
      assert.equal(app.calls.filter(call => call === 'POST guest chat').length, 0);
      assert.equal(app.location.hash, hash);
      app.navigate('/chat'); await tick();
      assert.equal(app.state.canSubmitGuestChat.value, true, 'An explicit new unscoped guest chat remains available');
    }
  });

  it("renders identity recovery before guest work surfaces and exposes explicit retry/sign-in actions", () => {
    const template = source.slice(source.indexOf('<template>'));
    const gate = template.indexOf('<main v-if="authGateVisible"');
    const guestHome = template.indexOf('<main v-else-if="currentRoute === \'home\' && !currentUser"');
    assert.ok(gate >= 0 && guestHome > gate);
    assert.match(template.slice(gate, guestHome), /v-if="authReadError"[^>]*@click="initializeSession"/);
    assert.match(template.slice(gate, guestHome), /@click="navigateToAuth\('login'\)"/);
  });

  it("restores an owned saved session and selected historical request when indexes fail or omit it", async () => {
    for (const failIndex of [false, true]) {
      const app = mount({ projects: [], index: async () => {
        if (failIndex) throw new Error('Index offline');
        return { sessions: [], unlinkedRequests: [] };
      } });
      lastWork.saveWorkspaceNavigation(app.storage, 'owner-a', { activeView: 'conversations', last: {
        view: 'conversations', page: 'chat', chatId: 's1', requestId: 'r1',
      } });
      await app.state.initializeSession(); await tick();
      assert.equal(app.location.hash, '#/chat?sessionId=s1&projectId=p1&requestId=r1');
      assert.ok(app.calls.includes('GET session:s1'));
      assert.ok(app.calls.includes('GET request:p1:r1'));
      assert.ok(!app.calls.some(call => /POST|PATCH|DELETE/.test(call)));
    }
  });

  it("does not let an old startup mark a newer account ready, including A to B to A", async () => {
    for (const owner of ['owner-b', 'owner-a']) {
      const pending = deferred<unknown>();
      const app = mount({ index: () => pending.promise });
      const startup = app.state.initializeSession(); await tick();
      app.currentUser.value = { id: 'owner-b' }; await tick();
      if (owner === 'owner-a') { app.currentUser.value = { id: 'owner-a' }; await tick(); }
      const before = [...app.storageData.entries()];
      pending.resolve({ sessions: [session], unlinkedRequests: [] });
      await startup; await tick();
      assert.equal(app.state.isSessionReady.value, false);
      assert.deepEqual([...app.storageData.entries()], before);
      assert.equal(app.location.hash, '');
    }
  });
  it("keeps explicit canonical session links even without a project or sidebar row", async () => {
    for (const hash of ["#/chat?sessionId=projectless", "#/chat?sessionId=s1", "#/chat?sessionId=s1&projectId=p1&requestId=r1"]) {
      const app = mount({ hash, index: async () => ({ sessions: [], unlinkedRequests: [] }) });
      lastWork.saveLastWork(app.storage, "owner-a", { view: "tests", projectId: "p1", sessionId: "another" });
      await app.state.initializeSession(); await tick();
      assert.equal(app.location.hash, hash, 'An explicit link is authorized by session detail, not a capped list');
      assert.ok(app.calls.every(call => call.startsWith('GET')), 'Restoring a link performs no mutation or fallback navigation');
    }
  });

  it("retains explicit legacy session/request links outside indexes and during transient failure", async () => {
    for (const hash of ['#/tests?projectId=p1&sessionId=s1&requestId=r1', '#/tests?projectId=p1&requestId=r1']) {
      const app = mount({ hash, projects: [], index: async () => ({ sessions: [], unlinkedRequests: [] }) });
      await app.state.initializeSession(); await tick();
      assert.equal(app.location.hash, hash);
      assert.ok(app.calls.includes('GET request:p1:r1'));
      assert.ok(app.calls.every(call => call.startsWith('GET')));
    }
    const hash = '#/tests?projectId=p1&sessionId=s1';
    const app = mount({ hash, readSession: async () => { throw Object.assign(new Error('Offline'), { status: 503 }); } });
    await app.state.initializeSession(); await tick();
    assert.equal(app.location.hash, hash);
    assert.equal(app.state.isSessionReady.value, true);
  });

  it("preserves a canonical session URL when the sidebar read fails", async () => {
    const hash = "#/chat?sessionId=projectless";
    const app = mount({ hash, index: async () => { throw new Error('temporarily offline'); } });
    await app.state.initializeSession(); await tick();
    assert.equal(app.location.hash, hash);
    assert.ok(app.state.testLoadError.value);
    assert.ok(app.calls.every(call => call.startsWith('GET')));
  });

  it("returns explicit deleted test/project destinations to their own workspace start", async () => {
    for (const hash of ["#/tests?projectId=deleted&sessionId=s1", "#/projects?view=tests&projectId=deleted", "#/projects?projectId=deleted"]) {
      const app = mount({ hash });
      await app.state.initializeSession(); await tick();
      assert.equal(app.location.hash, hash === "#/projects?projectId=deleted" ? "#/home" : "#/chat");
    }
  });

  it("does not let a delayed workspace switch override a newer explicit action", async () => {
    const pending = deferred<TestSessionDetail>();
    const app = mount({ hash: "#/home", readSession: () => pending.promise });
    lastWork.saveWorkspaceNavigation(app.storage, "owner-a", { activeView: "tests", tests: { view: "tests", projectId: "p1", sessionId: "s1" } });
    await app.state.initializeSession(); await tick();
    const restoring = app.state.restoreWorkspace("tests"); await tick();
    assert.ok(app.calls.includes('GET session:s1'));
    app.state.handleOpenHome(); await tick();
    pending.resolve(sessionDetail());
    await restoring; await tick();
    assert.equal(app.location.hash, "#/home");
    assert.equal(app.state.restoringView.value, null);
  });
  it("restores the one last session and does not let an obsolete QA filter change its target", async () => {
    const app = mount({ hash: "#/tests?projectId=p1&sessionId=s1", projects: [project, { id: "p2", name: "Other project" }] });
    lastWork.saveWorkspaceNavigation(app.storage, "owner-a", { activeView: "tests", last: { view: "tests", projectId: "p1", sessionId: "s1" } });
    await app.state.initializeSession(); await tick();
    app.state.qaProjectFilter.value = "p2";
    await tick();
    assert.equal(app.testScope.value.sessionId, "s1");
    await app.state.restoreWorkspace("conversations"); await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=s1&projectId=p1");
    app.state.handleNewChat(); await tick();
    assert.equal(app.location.hash, "#/chat");
    assert.ok(app.calls.every(call => call.startsWith("GET") || call.startsWith("navigate:")));
  });

  it("does not replace a saved QA destination while visiting project management or settings", async () => {
    const app = mount({ hash: "#/tests?projectId=p1&sessionId=s1" });
    await app.state.initializeSession(); await tick();
    app.state.handleOpenProjects(); await tick();
    assert.equal(app.location.hash, "#/projects");
    app.state.handleOpenProject("p1"); await tick();
    assert.equal(app.location.hash, "#/projects?projectId=p1");
    app.navigate("/settings"); await tick();
    await app.state.restoreWorkspace("tests"); await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=s1&projectId=p1");
  });

  it("preserves failed restoration for retry instead of interpreting network failure as deletion", async () => {
    let fail = false;
    const app = mount({ hash: "#/home", readSession: async () => { if (fail) throw new Error("offline"); return sessionDetail(); } });
    lastWork.saveWorkspaceNavigation(app.storage, "owner-a", { activeView: "tests", last: { view: "tests", projectId: "p1", sessionId: "s1" } });
    await app.state.initializeSession(); await tick();
    fail = true;
    await app.state.restoreWorkspace("tests"); await tick();
    assert.equal(app.location.hash, "#/home");
    assert.ok(app.state.restoreError.value);
    assert.equal(lastWork.readWorkspaceNavigation(app.storage, "owner-a").last?.sessionId, "s1");
    fail = false;
    await app.state.restoreWorkspace("tests", false); await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=s1&projectId=p1");
  });

  it("falls back for a confirmed deleted destination, not to another project's session", async () => {
    const app = mount({ hash: "#/home" });
    lastWork.saveWorkspaceNavigation(app.storage, "owner-a", { activeView: "tests", last: { view: "tests", projectId: "deleted", sessionId: "s1" } });
    await app.state.initializeSession(); await tick();
    await app.state.restoreWorkspace("tests"); await tick();
    assert.equal(app.location.hash, "#/home");
  });
  it("loads and navigates without generating or starting a test, including explicit old record links", async () => {
    const app = mount({ hash: "#/tests?projectId=p1&requestId=r1" });
    await app.state.initializeSession();
    assert.equal(app.location.hash, "#/tests?projectId=p1&requestId=r1");
    app.state.handleTestSelected({ ...session });
    await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=s1&projectId=p1");
    assert.ok(app.calls.every((call) => call.startsWith("GET") || call.startsWith("navigate:")));
  });

  it("restores authorized last work only without an explicit route", async () => {
    const app = mount();
    lastWork.saveLastWork(app.storage, "owner-a", { view: "tests", projectId: "p1", sessionId: "s1", requestId: "r1" });
    await app.state.initializeSession();
    await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=s1&projectId=p1&requestId=r1");
  });

  it("keeps an explicit conversation route above a stored Tests destination", async () => {
    const app = mount({ hash: "#/chat" });
    lastWork.saveLastWork(app.storage, "owner-a", { view: "tests", projectId: "p1", sessionId: "s1" });
    await app.state.initializeSession();
    assert.equal(app.location.hash, "#/chat");
  });

  it("does not override a newer in-project navigation when an index finishes late", async () => {
    const pending = deferred<unknown>();
    const app = mount({ index: () => pending.promise });
    const startup = app.state.initializeSession();
    await tick();
    app.navigate("/tests?projectId=p1&requestId=user-selected");
    await tick();
    pending.resolve({ sessions: [session], unlinkedRequests: [] });
    await startup;
    assert.equal(app.location.hash, "#/tests?projectId=p1&requestId=user-selected");
  });

  it("rejects a previous owner's delayed index and does not reveal it on logout", async () => {
    const pending = deferred<unknown>();
    const app = mount({ index: () => pending.promise });
    app.state.accountProjects.value = [project];
    const reading = app.state.loadTestIndex();
    app.currentUser.value = null;
    await tick();
    pending.resolve({ sessions: [session], unlinkedRequests: [] });
    await reading;
    assert.deepEqual(app.state.testSessions.value, []);
    assert.equal(app.state.isLoadingTests.value, false);
  });

  it("opens the same persisted Chat ID without a promotion or draft handoff", async () => {
    const chat = { id: "chat-existing", projectId: "p1", updatedAt: "2026-09-28T12:00:00.000Z", messages: [{ id: "message-a", content: "Discuss a login test" }] };
    const app = mount({ hash: "#/chat", chat, serverChats: [chat] });
    app.state.messageInput.value = "Do not lose this draft";
    app.state.handleSidebarChatSelected(chat.id); await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=chat-existing");
    assert.equal(app.state.messageInput.value, "Do not lose this draft");
    assert.ok(app.calls.every(call => !call.startsWith('POST')));
  });

  it("keeps Chat and its draft untouched when the server transcript changed before activation", async () => {
    const chat = { id: "chat-existing", projectId: "p1", updatedAt: "2026-09-28T12:00:00.000Z", messages: [{ id: "message-a", content: "Original" }] };
    const app = mount({ hash: "#/chat", chat, serverChats: [{ ...chat, messages: [{ id: "message-a", content: "Newer server text" }] }] });
    app.state.messageInput.value = "Keep me";
    app.state.handleSidebarChatSelected(chat.id); await tick();
    assert.equal(app.location.hash, "#/chat?sessionId=chat-existing");
    assert.equal(app.state.messageInput.value, "Keep me");
    assert.equal((app.state.chats as vue.Ref<unknown[]>).value.length, 1);
    assert.equal(app.calls.some(call => call.startsWith("POST activate")), false);
  });

  it("preserves test draft lifetime inside an account, never across owners", () => {
    assert.match(source, /<main v-if="currentUser" v-show="isUnifiedSession" :key="currentUser.id"/);
    assert.match(source, /<KeepAlive>\s*<SessionPage/);
    assert.match(source, /@scope-change="handleTestScopeChange"/);
    assert.match(source, /@session-updated="handleSessionUpdated"/);
    assert.doesNotMatch(source, /StartTest|draft-handoff|TestDraftHandoff/);
  });
  it("opens the actual project page while retaining one managed writer/controller", async () => {
    const app = mount({ hash: '#/chat?sessionId=s1&projectId=p1' });
    await app.state.initializeSession(); await tick();
    app.state.handleOpenProject('p1'); await tick();
    assert.equal(app.state.isUnifiedSession.value, false);
    assert.equal(app.state.isProjectSessionDraft.value, true);
    assert.equal(app.state.isSessionControllerActive.value, true);
    assert.deepEqual(app.state.sessionPageScope.value, { projectId: 'p1' });
    assert.match(source, /:composer-target="isProjectSessionDraft \? projectSessionComposerTarget : null"/);
    assert.equal((source.match(/<SessionPage\b/g) || []).length, 1);
    assert.ok(app.calls.every(call => !call.startsWith('POST')));
  });
  it("does not detach orphaned legacy sessions based on a project-list response", async () => {
    const app = mount({ hash: '#/chat', chat: { id: 'legacy', projectId: 'not-listed', updatedAt: '2026-10-04T00:00:00Z', messages: [] } });
    await app.state.loadAccountProjects(); await tick();
    assert.equal(app.state.selectedProjectId.value, 'not-listed');
    assert.equal(app.state.chats.value[0].projectId, 'not-listed');
    assert.doesNotMatch(source, /clearUnavailableProjectAssignments/);
  });
  it("does not export an unrelated legacy chat from a project draft", async () => {
    const app = mount({ hash: '#/projects?projectId=p1' });
    await app.state.initializeSession(); await tick();
    const exports: string[] = [];
    app.state.sessionPage.value = { exportTranscript: (format: string) => exports.push(format) };
    app.state.handleExportSession('md');
    assert.deepEqual(exports, ['md']);
  });
});

describe("project Add chats managed-session mutations", () => {
  const detail = (id: string, changes: Partial<TestSessionDetail> = {}): TestSessionDetail => ({
    id, projectId: '', title: 'Conversation', version: 3, archivedAt: null,
    createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:30:00Z', currentRequestId: null,
    messages: [], requests: [], pendingProposal: null, turnStatus: null, preparation: null, managed: true, ...changes,
  });
  it("keeps the open session URL in its acknowledged new project and coordinates draft relocation", async () => {
    let saved = detail('moving', { projectId: 'p1' });
    const steps: string[] = [];
    const app = mount({ hash: '#/chat?sessionId=moving&projectId=p1', readSession: async () => saved,
      index: async () => ({ sessions: [saved], unlinkedRequests: [] }),
      moveSession: async (_id, input) => { steps.push('move'); saved = { ...saved, projectId: input.projectId || '' }; return saved; } });
    await app.state.initializeSession(); await tick();
    app.state.sessionPage.value = { checkProjectMove: async (id: string, from: string, to: string) => { steps.push(`check:${id}:${from}:${to}`); },
      applyProjectMove: async (value: TestSessionDetail, from: string) => { steps.push(`draft:${value.id}:${from}:${value.projectId}`); } };
    await app.state.handleMoveSession('moving', 'p1', 'p2'); await tick();
    assert.equal(app.location.hash, '#/chat?sessionId=moving&projectId=p2');
    assert.deepEqual(steps, ['check:moving:p1:p2', 'move', 'draft:moving:p1:p2']);
    assert.match(source, /:move-session="handleMoveSession"/);
  });
  it("does not relocate or write a session after a draft conflict, or follow a late move after navigation", async () => {
    let saved = detail('moving', { projectId: 'p1' });
    const moved = deferred<TestSessionDetail>();
    const app = mount({ hash: '#/chat?sessionId=moving&projectId=p1', readSession: async () => saved,
      index: async () => ({ sessions: [saved], unlinkedRequests: [] }), moveSession: async () => moved.promise });
    await app.state.initializeSession(); await tick();
    app.state.sessionPage.value = { checkProjectMove: async () => { throw new Error('Draft conflict'); } };
    await assert.rejects(app.state.handleMoveSession('moving', 'p1', 'p2'), /Draft conflict/);
    assert.ok(!app.calls.some(call => call.startsWith('PATCH')));
    app.state.sessionPage.value = { checkProjectMove: async () => {}, applyProjectMove: async () => {} };
    const operation = app.state.handleMoveSession('moving', 'p1', 'p2'); await tick();
    app.navigate('/chat?sessionId=another&projectId=p1'); await tick();
    saved = { ...saved, projectId: 'p2' }; moved.resolve(saved); await operation;
    assert.equal(app.location.hash, '#/chat?sessionId=another&projectId=p1');
  });
  it("uses the retained account editor for inactive drafts without navigating back to it", async () => {
    let saved = detail('moving', { projectId: 'p1' });
    const steps: string[] = [];
    const app = mount({ hash: '#/chat?sessionId=moving&projectId=p1', readSession: async () => saved,
      index: async () => ({ sessions: [saved], unlinkedRequests: [] }),
      moveSession: async (_id, input) => { saved = { ...saved, projectId: input.projectId || '' }; return saved; } });
    await app.state.initializeSession(); await tick();
    app.state.sessionPage.value = { checkProjectMove: async () => { steps.push('check'); }, applyProjectMove: async () => { steps.push('relocate'); } };
    app.navigate('/settings'); app.state.sessionPage.value = null; await tick();
    await app.state.handleMoveSession('moving', 'p1', 'p2');
    assert.deepEqual(steps, ['check', 'relocate']);
    assert.equal(app.location.hash, '#/settings');
  });
  it("moves deduplicated signed-in selections using current server versions, without local chat snapshot writes", async () => {
    let saved = detail('standalone');
    const writes: unknown[] = [];
    const app = mount({ hash: '#/projects?projectId=p1', readSession: async () => saved,
      index: async () => ({ sessions: [saved], unlinkedRequests: [] }),
      moveSession: async (id, input) => { writes.push({ id, ...input }); saved = { ...saved, projectId: input.projectId || '', version: 4 }; return saved; } });
    await app.state.initializeSession(); await tick();
    await app.state.handleAddChatsToProject(['standalone', 'standalone'], 'p1');
    assert.deepEqual(writes, [{ id: 'standalone', projectId: 'p1', expectedSessionVersion: 3, expectedUpdatedAt: '2026-10-05T10:30:00Z' }]);
    assert.equal(app.state.testSessions.value[0].projectId, 'p1');
    assert.equal(app.calls.filter(call => call.startsWith('PATCH')).length, 1);
    assert.ok(app.calls.every(call => !call.startsWith('local assign:')));
    assert.match(source, /:add-chats-to-project="handleAddChatsToProject"/);
  });
  it("settles legacy pending saves and re-reads before adopting and moving the same identity", async () => {
    let saved = detail('legacy', { managed: false });
    let readCount = 0, persistCount = 0;
    const writes: number[] = [];
    const app = mount({ readSession: async () => { readCount++; return saved; },
      persist: async () => { persistCount++; saved = { ...saved, version: 5, updatedAt: '2026-10-05T11:00:00Z' }; },
      moveSession: async (_id, input) => { writes.push(input.expectedSessionVersion); return { ...saved, projectId: 'p1', managed: true }; } });
    await app.state.handleAddChatsToProject(['legacy'], 'p1');
    assert.equal(readCount, 2);
    assert.equal(persistCount, 1);
    assert.deepEqual(writes, [5]);
    assert.ok(app.calls.every(call => !call.startsWith('local assign:')));
  });
  it("keeps successful partial moves when another selection and index refresh fail", async () => {
    const first = detail('first'), second = detail('second');
    const app = mount({ readSession: async id => id === first.id ? first : second,
      index: async () => { throw new Error('Index unavailable'); },
      moveSession: async id => { if (id === 'second') throw new Error('Version conflict'); return { ...first, projectId: 'p1' }; } });
    app.state.testSessions.value = [first, second];
    await assert.rejects(app.state.handleAddChatsToProject(['first', 'second'], 'p1'), /Version conflict/);
    assert.equal(app.state.testSessions.value.find((item: { id: string }) => item.id === 'first').projectId, 'p1');
    assert.equal(app.state.testSessions.value.find((item: { id: string }) => item.id === 'second').projectId, '');
    assert.equal(app.state.testLoadError.value, 'Index unavailable');
  });
  it("rechecks QA linkage and archives after reading, and refuses pseudo request records", async () => {
    for (const changes of [{ requests: [{ id: 'qa' }] as TestSessionDetail['requests'] }, { archivedAt: '2026-10-05' }]) {
      const app = mount({ readSession: async () => detail('selected', changes) });
      await assert.rejects(app.state.handleAddChatsToProject(['selected'], 'p1'), /projects.addChats.notMovable/);
      assert.ok(app.calls.every(call => !call.startsWith('PATCH') && !call.startsWith('local assign:')));
    }
    const app = mount();
    await assert.rejects(app.state.handleAddChatsToProject(['request:legacy'], 'p1'), /projects.addChats.notMovable/);
    assert.ok(app.calls.every(call => !call.startsWith('GET session:') && !call.startsWith('PATCH')));
  });
  it("rejects late session reads even if the original account signs in again before they return", async () => {
    const pending = deferred<TestSessionDetail>();
    const app = mount({ readSession: () => pending.promise });
    const adding = app.state.handleAddChatsToProject(['private'], 'p1');
    app.currentUser.value = { id: 'owner-b' };
    app.currentUser.value = { id: 'owner-a' };
    pending.resolve(detail('private'));
    await assert.rejects(adding, /testSessions.errors.scope/);
    assert.ok(app.calls.every(call => !call.startsWith('PATCH') && !call.startsWith('local assign:')));
  });
  it("preserves guest local assignment behavior without session requests", async () => {
    const app = mount(); app.currentUser.value = null;
    await app.state.handleAddChatsToProject(['guest', 'guest'], 'p1');
    assert.deepEqual(app.calls.filter(call => call.startsWith('local assign:')), ['local assign:guest:p1']);
    assert.ok(app.calls.every(call => !call.startsWith('GET session:') && !call.startsWith('PATCH')));
  });
});

describe("account-owned list and usage read recovery", () => {
  it("retains successful projects, sessions and usage on failed refresh and replaces them only after successful retry", async () => {
    let failing = false;
    let projects = [project];
    let sessions = [session];
    let usage = { limit: 100, remaining: 73, used: 27, unit: "credits" };
    const app = mount({
      hash: "#/chat",
      readProjects: async () => { if (failing) throw new Error("projects temporarily offline"); return projects; },
      index: async () => { if (failing) throw new Error("sessions temporarily offline"); return { sessions, unlinkedRequests: [] }; },
      usage: async () => { if (failing) throw new Error("usage temporarily offline"); return usage; },
    });
    await app.state.initializeSession(); await tick();
    assert.deepEqual(app.state.accountProjects.value, projects);
    assert.deepEqual(app.state.testSessions.value, sessions);
    assert.deepEqual(app.state.usageSummary.value, usage);

    failing = true;
    await Promise.all([app.state.loadAccountProjects(), app.state.loadTestIndex(true), app.state.refreshUsage()]);
    await tick();
    assert.deepEqual(app.state.accountProjects.value, projects, "a failed project read is not deletion");
    assert.deepEqual(app.state.testSessions.value, sessions, "a failed session read must not remove owned sidebar rows");
    assert.deepEqual(app.state.usageSummary.value, usage, "a failed usage read must not zero or hide the last balance");
    assert.equal(app.state.projectLoadError.value, "projects temporarily offline");
    assert.equal(app.state.testLoadError.value, "sessions temporarily offline");
    assert.equal(app.state.usageError.value, "sessionTools.usage.unavailable");
    assert.equal(app.state.isLoadingProjects.value, false);
    assert.equal(app.state.isLoadingTests.value, false);
    assert.equal(app.state.usageLoading.value, false);

    failing = false;
    projects = [{ id: "p2", name: "Recovered project" }];
    sessions = [{ ...session, id: "s2", projectId: "p2", title: "Recovered session" }];
    usage = { ...usage, remaining: 62, used: 38 };
    await Promise.all([app.state.loadAccountProjects(), app.state.loadTestIndex(true), app.state.refreshUsage()]);
    await tick();
    assert.deepEqual(app.state.accountProjects.value, projects);
    assert.deepEqual(app.state.testSessions.value, sessions);
    assert.deepEqual(app.state.usageSummary.value, usage);
    assert.equal(app.state.projectLoadError.value, "");
    assert.equal(app.state.testLoadError.value, "");
    assert.equal(app.state.usageError.value, "");
    assert.equal(app.location.hash, "#/chat");
    assert.ok(app.calls.every(call => call.startsWith("GET")), "read recovery must not create, navigate or execute work");
  });

  it("keeps a valid authoritative balance when a usage refresh is incomplete or non-finite", async () => {
    let response: unknown = { limit: 100, remaining: 73, used: 27, unit: "credits" };
    const app = mount({ hash: "#/chat", usage: async () => response });
    await app.state.initializeSession(); await tick();
    const retained = app.state.usageSummary.value;
    assert.equal(retained.remaining, 73);
    for (const incomplete of [{ remaining: 0 }, { limit: 100, remaining: Number.NaN, used: 27 }, { limit: Number.POSITIVE_INFINITY, remaining: 73, used: 27 }]) {
      response = incomplete;
      await app.state.refreshUsage();
      assert.equal(app.state.usageSummary.value, retained, "an invalid refresh does not replace the last validated balance");
      assert.equal(app.state.usageLoading.value, false);
    }
  });

  for (const nextOwner of [null, "owner-b"] as const) {
    it(`clears private lists and usage synchronously and ignores earlier project/usage reads after ${nextOwner ? "an account switch" : "logout"}`, async () => {
      const oldProjects = deferred<Array<{ id: string; name: string }>>();
      const oldUsage = deferred<unknown>();
      const nextProjects = [{ id: "owner-b-project", name: "Another owner's project" }];
      const nextUsage = { limit: 50, remaining: 41, used: 9, unit: "credits" };
      let phase: "initial" | "pending-old" | "next-owner" = "initial";
      const app = mount({
        hash: "#/chat",
        readProjects: () => phase === "pending-old" ? oldProjects.promise : Promise.resolve(phase === "next-owner" ? nextProjects : [project]),
        index: async () => ({ sessions: phase === "next-owner" ? [] : [session], unlinkedRequests: [] }),
        usage: () => phase === "pending-old" ? oldUsage.promise : Promise.resolve(phase === "next-owner" ? nextUsage : { limit: 100, remaining: 73, used: 27 }),
      });
      await app.state.initializeSession(); await tick();
      assert.equal(app.state.accountProjects.value[0].id, project.id);
      assert.equal(app.state.testSessions.value[0].id, session.id);
      assert.equal(app.state.usageSummary.value.remaining, 73);

      phase = "pending-old";
      const readingProjects = app.state.loadAccountProjects();
      const readingUsage = app.state.refreshUsage();
      phase = "next-owner";
      app.currentUser.value = nextOwner ? { id: nextOwner } : null;
      // No DOM tick: the identity watch must erase the previous owner immediately.
      assert.deepEqual(app.state.accountProjects.value, []);
      assert.deepEqual(app.state.testSessions.value, []);
      assert.equal(app.state.usageSummary.value, null);
      assert.equal(app.state.usageError.value, "");

      if (nextOwner) { await tick(); await app.state.refreshUsage(); }
      oldProjects.resolve([project]);
      oldUsage.resolve({ limit: 100, remaining: 1, used: 99 });
      await Promise.all([readingProjects, readingUsage]); await tick();
      assert.deepEqual(app.state.accountProjects.value, nextOwner ? nextProjects : []);
      assert.deepEqual(app.state.testSessions.value, []);
      assert.deepEqual(app.state.usageSummary.value, nextOwner ? nextUsage : null);
      assert.equal(app.state.projectLoadError.value, "");
      assert.equal(app.state.usageError.value, "");
      assert.equal(app.state.isLoadingProjects.value, false);
      assert.equal(app.state.usageLoading.value, false);
    });
  }
});
