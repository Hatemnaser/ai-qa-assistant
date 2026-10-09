import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { sessionDecision } from "../src/features/test-sessions/decisionPresentation";

const pageFile = new URL("../src/features/sessions/SessionPage.vue", import.meta.url);
const source = await readFile(pageFile, "utf8");
const script = transpileModule(compileScript(parse(source, { filename: fileURLToPath(pageFile) }).descriptor, { id: "session-page-tools" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const scopes: vue.EffectScope[] = [];
describe("empty session presentation", () => {
  it("keeps saved history in navigation, not in the new-session transcript", async () => {
    assert.doesNotMatch(source, /recentSessions|project-chat-list|open-session/);
    assert.match(source, /t\('sessionTools.start.heading'\)/);
    assert.match(source, /t\('sessionTools.start.body'\)/);
    const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /:recent-sessions=/);
  });
});
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  restoreGlobal("document", originalDocument);
  restoreGlobal("HTMLElement", originalHTMLElement);
});

type Tool = "sources" | "activity" | "results";
type RequestIdentity = { id: string; phase: string; title: string; operations: unknown[] };
type SessionIdentity = { id: string; currentRequestId: string; requests: RequestIdentity[]; archivedAt: null; pendingProposal: { id: string; title: string } | null; preparation: null };
type PageBindings = {
  currentTool: vue.Ref<Tool | null>;
  connectionOpen: vue.Ref<boolean>;
  record: vue.Ref<{ $el: { focus(options: { preventScroll: boolean }): void }; openMissing(): void } | null>;
  openResults(id: string): Promise<void>;
  focusRecord(): Promise<boolean>;
  focusMissing(): Promise<void>;
  openTool(tool: Tool, toggle?: boolean): void;
  closeTool(): void;
  closeTransientTools(): void;
  openConnections(): Promise<void>;
  reviewRequestId: vue.Ref<string>;
  decision: vue.ComputedRef<string>;
  pendingReviews: vue.ComputedRef<RequestIdentity[]>;
};

function request(id = "request-a"): RequestIdentity {
  return { id, phase: "APPROVED", title: id, operations: [] };
}

function session(id = "session-a"): SessionIdentity {
  return { id, currentRequestId: "request-a", requests: [request()], archivedAt: null, pendingProposal: null, preparation: null };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  for (let index = 0; index < 4; index += 1) await vue.nextTick();
}

function mount(selection: (id: string) => Promise<void> = async () => {}) {
  class TestElement {}
  // The rejected paths need no DOM renderer. An explicit newer tool intent only
  // captures this inert active-element stub, never an application element.
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: TestElement });
  const props = vue.reactive({ currentUser: { id: "owner-a" }, active: true, sessionId: "session-a", projectLoadError: "", isLoadingProjects: false });
  const selectCalls: string[] = [];
  const controller = {
    projectId: vue.ref("project-a"), project: vue.ref({ id: "project-a", name: "Project A" }),
    session: vue.ref<SessionIdentity | null>(session()), request: vue.ref<RequestIdentity | null>(request()), selectedRequestId: vue.ref("request-a"),
    artifact: vue.ref(null), run: vue.ref(null), profiles: vue.ref([]), profileId: vue.ref(""), profileError: vue.ref(""),
    profilesLoading: vue.ref(false), loading: vue.ref(false), busy: vue.ref(false), readError: vue.ref(""), error: vue.ref(""),
    message: vue.ref("Unsent draft stays untouched"), model: vue.ref("model-a"), selectedAttachments: vue.ref([]),
    turnBusy: vue.ref(false), blocked: vue.ref(false), canStart: vue.ref(false), canSelect: vue.ref(false),
    canReview: vue.ref(false), canPrepare: vue.ref(false), viewingPast: vue.ref(false), approvalAvailable: vue.ref(false),
    nextAction: vue.ref({ action: "none", messageKey: "testSessions.loading" }),
    async selectRequest(id: string) { selectCalls.push(id); await selection(id); },
  };
  const activated: Array<() => void> = [];
  const deactivated: Array<() => void> = [];
  const modules: Record<string, unknown> = {
    vue: { ...vue, onActivated: (hook: () => void) => activated.push(hook), onDeactivated: (hook: () => void) => deactivated.push(hook) },
    "../../i18n/useI18n": { useI18n: () => ({ t: (key: string) => key, formatDate: (value: string) => value }) },
    "./sessionTimeline": { sessionTimeline: () => [] },
    "../test-sessions/decisionPresentation": { sessionDecision },
    "./sessionSources": { buildSessionSources: () => [] },
    "./sessionActivityPresentation": { isPrimarySessionEvent: () => true, qaEventLabelKey: () => "sessionTools.events.recorded" },
    "../chat/chatExport": { exportChatByFormat: () => {}, exportAnswerByFormat: () => {} },
    "../test-sessions/useTestSession": { useTestSession: () => controller },
    "../test-sessions/sessionPresentation": { testSessionTranscript: () => ({}) },
  };
  const module = { exports: {} as { default: { setup(props: unknown, context: unknown): PageBindings } } };
  new Function("require", "exports", script)((id: string) => {
    if (id.endsWith(".vue")) return {};
    assert.ok(id in modules, `Unexpected SessionPage dependency: ${id}`);
    return modules[id];
  }, module.exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const page = scope.run(() => module.exports.default.setup(props, { expose: () => {}, emit: () => {} }))!;
  const focusCalls: Array<{ preventScroll: boolean }> = [];
  let missingCalls = 0;
  page.record.value = { $el: { focus: options => { focusCalls.push(options); } }, openMissing: () => { missingCalls += 1; } };
  return {
    page, props, controller, selectCalls, focusCalls, missingCalls: () => missingCalls,
    deactivate: () => deactivated.forEach(hook => hook()), activate: () => activated.forEach(hook => hook()),
  };
}

function restoreGlobal(name: "document" | "HTMLElement", descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe("SessionPage asynchronous tool intents", () => {
  it("opens and focuses the explicitly selected owned result without touching the writer", async () => {
    const view = mount();
    await view.page.openResults("request-a");
    assert.equal(view.page.currentTool.value, "results");
    assert.deepEqual(view.focusCalls, [{ preventScroll: true }]);
    assert.deepEqual(view.selectCalls, ["request-a"]);
    assert.equal(view.controller.message.value, "Unsent draft stays untouched");
  });

  for (const boundary of ["project", "session", "account"] as const) {
    it(`rejects a delayed result selection after the ${boundary} changes`, async () => {
      const delayed = deferred();
      const view = mount(() => delayed.promise);
      const opening = view.page.openResults("request-a");
      if (boundary === "project") view.controller.projectId.value = "project-b";
      if (boundary === "session") view.controller.session.value = session("session-b");
      if (boundary === "account") view.props.currentUser.id = "owner-b";
      await settle();
      delayed.resolve(); await opening;
      assert.equal(view.page.currentTool.value, null);
      assert.deepEqual(view.focusCalls, []);
      assert.equal(view.controller.message.value, "Unsent draft stays untouched");
    });
  }

  it("rejects delayed results after KeepAlive deactivation even if the old active prop stays true", async () => {
    const delayed = deferred();
    const view = mount(() => delayed.promise);
    const opening = view.page.openResults("request-a");
    view.deactivate();
    assert.equal(view.props.active, true, "KeepAlive can retain the prior vnode props");
    delayed.resolve(); await opening;
    view.activate(); await settle();
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
  });

  it("rejects a pending selection when the controller becomes inactive", async () => {
    const delayed = deferred();
    const view = mount(() => delayed.promise);
    const opening = view.page.openResults("request-a");
    view.props.active = false;
    delayed.resolve(); await opening;
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
  });

  for (const tool of ["sources", "activity"] as const) {
    it(`keeps a newer explicit ${tool} intent when an older result selection finishes`, async () => {
      const delayed = deferred();
      const view = mount(() => delayed.promise);
      const opening = view.page.openResults("request-a");
      view.page.openTool(tool);
      delayed.resolve(); await opening;
      assert.equal(view.page.currentTool.value, tool);
      assert.deepEqual(view.focusCalls, []);
    });
  }

  it("does not reopen a tool after the user explicitly closes a pending result intent", async () => {
    const delayed = deferred();
    const view = mount(() => delayed.promise);
    const opening = view.page.openResults("request-a");
    view.page.closeTool();
    delayed.resolve(); await opening;
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
  });

  it("keeps an explicit toggle-to-closed state after a delayed result intent", async () => {
    const delayed = deferred();
    const view = mount(() => delayed.promise);
    view.page.openTool("sources");
    const opening = view.page.openResults("request-a");
    view.page.openTool("sources", true);
    delayed.resolve(); await opening;
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
  });

  it("only the newest concurrent result intent can focus its selected record", async () => {
    const first = deferred();
    const second = deferred();
    const view = mount(id => id === "request-a" ? first.promise : second.promise);
    const oldOpening = view.page.openResults("request-a");
    const newOpening = view.page.openResults("request-b");
    view.controller.selectedRequestId.value = "request-b";
    view.controller.request.value = request("request-b");
    second.resolve(); await newOpening;
    assert.equal(view.page.currentTool.value, "results");
    assert.equal(view.focusCalls.length, 1);
    first.resolve(); await oldOpening;
    assert.equal(view.focusCalls.length, 1, "discarded selection completion must not refocus the current record");
  });

  for (const failure of ["read error", "project read error", "loading", "selected ID mismatch", "detail ID mismatch"] as const) {
    it(`does not open results with ${failure}`, async () => {
      const delayed = deferred();
      const view = mount(() => delayed.promise);
      const opening = view.page.openResults("request-a");
      if (failure === "read error") view.controller.readError.value = "offline";
      if (failure === "project read error") view.props.projectLoadError = "project offline";
      if (failure === "loading") view.controller.loading.value = true;
      if (failure === "selected ID mismatch") view.controller.selectedRequestId.value = "request-b";
      if (failure === "detail ID mismatch") view.controller.request.value = request("request-b");
      delayed.resolve(); await opening;
      assert.equal(view.page.currentTool.value, null);
      assert.deepEqual(view.focusCalls, []);
    });
  }

  it("cancels deferred record focus and missing-evidence navigation when a newer close wins", async () => {
    const view = mount();
    const opening = view.page.focusMissing();
    view.page.closeTool();
    await opening;
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
    assert.equal(view.missingCalls(), 0);
  });

  it("does not focus an already opened record in a different session after the DOM tick", async () => {
    const view = mount();
    const focusing = view.page.focusRecord();
    view.controller.session.value = session("session-b");
    assert.equal(await focusing, false);
    assert.equal(view.page.currentTool.value, null);
    assert.deepEqual(view.focusCalls, []);
  });
});

describe("SessionPage connection modal continuations", () => {
  it("closes the existing tool before opening a connection modal in the same active scope", async () => {
    const view = mount();
    view.page.openTool("activity");
    const opening = view.page.openConnections();
    assert.equal(view.page.currentTool.value, null);
    assert.equal(view.page.connectionOpen.value, false);
    await opening;
    assert.equal(view.page.connectionOpen.value, true);
  });

  for (const boundary of ["project", "session", "account", "deactivation", "inactive", "cancel"] as const) {
    it(`does not open the modal after ${boundary} changes before nextTick`, async () => {
      const view = mount();
      const opening = view.page.openConnections();
      if (boundary === "project") view.controller.projectId.value = "project-b";
      if (boundary === "session") view.controller.session.value = session("session-b");
      if (boundary === "account") view.props.currentUser.id = "owner-b";
      if (boundary === "deactivation") view.deactivate();
      if (boundary === "inactive") view.props.active = false;
      if (boundary === "cancel") view.page.closeTransientTools();
      await opening;
      assert.equal(view.page.connectionOpen.value, false);
      assert.deepEqual(view.focusCalls, []);
    });
  }
});

describe("SessionPage explicit pending review selection", () => {
  async function pendingReview() {
    const view = mount();
    view.controller.session.value!.pendingProposal = { id: "proposal-next", title: "Next test" };
    view.controller.session.value!.requests = [{ ...request(), phase: "READY_FOR_REVIEW" }];
    view.controller.request.value = { ...request(), phase: "READY_FOR_REVIEW" };
    view.controller.canReview.value = true;
    await settle();
    assert.equal(view.page.decision.value, "proposal");
    assert.deepEqual(view.page.pendingReviews.value.map(item => item.id), ["request-a"]);
    // Match the pending-review button: select the review, then let the controller
    // refresh the selected record/session. The new proposal stays saved.
    view.page.reviewRequestId.value = "request-a";
    await view.controller.selectRequest("request-a");
    await settle();
    assert.equal(view.page.decision.value, "review");
    return view;
  }

  it("keeps an explicitly selected review through selection refresh and repeated polling DTOs", async () => {
    const view = await pendingReview();
    for (let index = 0; index < 3; index += 1) {
      const current = view.controller.session.value!;
      view.controller.session.value = {
        ...current, pendingProposal: { ...current.pendingProposal! },
        requests: current.requests.map(item => ({ ...item })),
      };
      view.controller.request.value = { ...view.controller.request.value! };
      await settle();
      assert.equal(view.page.reviewRequestId.value, "request-a");
      assert.equal(view.page.decision.value, "review");
      assert.equal(view.controller.session.value!.pendingProposal!.id, "proposal-next");
    }
    assert.equal(view.controller.message.value, "Unsent draft stays untouched");
  });

  for (const boundary of ["project", "session", "account", "proposal"] as const) {
    it(`resets the review override when the actual ${boundary} identity changes`, async () => {
      const view = await pendingReview();
      if (boundary === "project") view.controller.projectId.value = "project-b";
      if (boundary === "session") view.controller.session.value = { ...view.controller.session.value!, id: "session-b" };
      if (boundary === "account") view.props.currentUser.id = "owner-b";
      if (boundary === "proposal") view.controller.session.value!.pendingProposal = { id: "replacement", title: "Different scope" };
      await settle();
      assert.equal(view.page.reviewRequestId.value, "");
      assert.equal(view.page.decision.value, "proposal");
    });
  }

  it("does not grant review actions while the selected record is loading or unreadable", async () => {
    const view = await pendingReview();
    view.controller.loading.value = true;
    assert.equal(view.page.decision.value, "loading");
    view.controller.loading.value = false;
    view.controller.readError.value = "offline";
    assert.equal(view.page.decision.value, "read-error");
    view.controller.readError.value = "";
    assert.equal(view.page.decision.value, "review");
    view.controller.canReview.value = false;
    view.controller.request.value = { ...request(), phase: "APPROVED" };
    assert.equal(view.page.decision.value, "proposal", "a completed record cannot override a pending proposal");
  });
});
