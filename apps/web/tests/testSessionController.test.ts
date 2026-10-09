import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as vue from "vue";
import * as drafts from "../src/features/chat/composables/useChatDrafts";
import * as attachments from "../src/features/chat/composables/useChatAttachments";
import * as constants from "../src/features/chat/constants";
import * as harness from "../src/features/qa/harnessPresentation";
import * as qaPresentation from "../src/features/qa/workspacePresentation";
import * as presentation from "../src/features/test-sessions/sessionPresentation";
import type { DraftPersistence, SavedDraft } from "../src/features/chat/draftPersistence";
import type { QaExecutionRecipe, QaRequestDetail, QaRunnerProfile } from "../src/features/qa/types";
import type { TestScope, TestSessionDetail, TestTurnInput } from "../src/features/test-sessions/types";
import type { TestSessionPageProps, useTestSession } from "../src/features/test-sessions/useTestSession";

const source = await readFile(new URL("../src/features/test-sessions/useTestSession.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const scopes: vue.EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));
const tick = async () => { for (let index = 0; index < 12; index += 1) await vue.nextTick(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

type Api = Record<string, (...args: any[]) => any>;
function mount(options: { sessionApi?: Api; qaApi?: Api; props?: Partial<TestSessionPageProps>; upload?: (...args: any[]) => any; echoScope?: boolean; persistence?: DraftPersistence } = {}) {
  const calls: string[] = [];
  const notifications: TestScope[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let activate = () => {};
  let deactivate = () => {};
  const sessionApi: Api = {
    fetchTestSession: async (_projectId: string, id: string) => { calls.push(`GET session ${id}`); return session(id); },
    createTestSession: async () => { calls.push("POST session"); return session("created"); },
    sendTestTurn: async (_projectId: string, id: string) => { calls.push("POST turn"); return { ...session(id), version: 2 }; },
    prepareTestSession: async () => { calls.push("POST prepare"); return session(); },
    resumeTestPreparation: async () => { calls.push("POST resume"); return session(); },
    updateTestSession: async () => { calls.push("PATCH session"); return session(); },
    deleteTestSession: async () => { calls.push("DELETE session"); return { ok: true }; },
    ...options.sessionApi,
  };
  const qaApi: Api = {
    fetchQaRequest: async (_projectId: string, id: string) => { calls.push(`GET request ${id}`); return request(id); },
    fetchQaRunnerProfiles: async () => { calls.push("GET profiles"); return []; },
    startQaRun: () => assert.fail("No test should run without an explicit valid approval."),
    ...options.qaApi,
  };
  const modules: Record<string, unknown> = {
    vue: { ...vue, onActivated: (callback: () => void) => { activate = callback; }, onDeactivated: (callback: () => void) => { deactivate = callback; } },
    "../../i18n/useI18n": { useI18n: () => ({ t: (key: string) => key }) },
    "../chat/constants": constants,
    "../chat/composables/useChatDrafts": drafts,
    "../chat/draftPersistence": { accountDraftPersistence: () => options.persistence },
    "../chat/composables/useChatAttachments": attachments,
    "../chat/chatAttachmentSubmission": { prepareChatAttachmentsForSubmit: options.upload || (async () => { calls.push("UPLOAD"); return { requestAttachments: null }; }) },
    "../assets/assetsApi": { getAssetDownloadUrl: async () => "https://example.invalid/private" },
    "../projects/projectsApi": { createProject: async () => { calls.push("POST project"); return { id: "created-project" }; } },
    "../qa/harnessPresentation": harness,
    "../qa/workspacePresentation": qaPresentation,
    "../qa/qaApi": qaApi,
    "../sessions/sessionApi": sessionApi,
    "./sessionPresentation": presentation,
  };
  const exports = {} as { useTestSession: typeof useTestSession };
  new Function("require", "exports", "setTimeout", "clearTimeout", compiled)((id: string) => {
    assert.ok(id in modules, `Unexpected dependency ${id}`);
    return modules[id];
  }, exports, (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; }, (id: number) => timers.delete(id));
  const props = vue.reactive<TestSessionPageProps>({
    currentUser: { id: "owner-a", createdAt: "now", email: "a@example.invalid", emailVerifiedAt: null, locale: "en", name: null },
    projects: [], preferredProjectId: "p1", sessionId: "s1", ...options.props,
  });
  const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => exports.useTestSession(props, {
    scopeChanged: value => {
      notifications.push(value);
      if (options.echoScope) { props.preferredProjectId = value.projectId; props.sessionId = value.sessionId; props.requestId = value.requestId; }
    },
    updated: () => calls.push("updated"), reloadProjects: () => calls.push("reload projects"),
  }))!;
  return { state, props, calls, notifications, timers, activate: () => activate(), deactivate: () => deactivate(), dispose: () => scope.stop() };
}

describe("Test session recovery and explicit approval", () => {
  it("restores an owned projectless session and its persisted draft without any QA action", async () => {
    const file = new File(['context'], 'context.txt', { type: 'text/plain' });
    const saved: SavedDraft = { message: 'Unsent follow-up', mode: 'test-cases', model: 'saved-model', quickAction: null,
      attachments: [{ file, name: file.name, mimeType: file.type, type: 'file' }] };
    const loaded: string[] = [];
    const app = mount({ props: { preferredProjectId: '', sessionId: 'ordinary' }, persistence: {
      load: async key => { loaded.push(key); return key === ':ordinary' ? saved : null; },
      save: async () => assert.fail('Restoration must not rewrite a stored draft'), remove: async () => assert.fail('Restoration must not delete a stored draft'),
    }, sessionApi: { fetchTestSession: async () => session('ordinary', { projectId: '', messages: [
      { id: 'm1', role: 'assistant', content: '| A | B |\n| - | - |\n| 1 | 2 |', createdAt: 'now', model: 'model' },
    ] }) } });
    await tick();
    assert.equal(app.state.session.value?.id, 'ordinary');
    assert.match(app.state.session.value!.messages[0]!.content, /\| A \| B \|/);
    assert.equal(app.state.message.value, saved.message);
    assert.equal(app.state.model.value, saved.model);
    assert.equal(app.state.selectedAttachments.value[0]?.file, file);
    assert.deepEqual(loaded, [':ordinary']);
    assert.deepEqual(app.calls, []); // The overridden owned session GET is the only API operation.
    assert.equal(app.notifications.length, 0);
    assert.equal(app.state.blocked.value, false);
  });

  it("infers an owned session project, restores its canonical draft and loads profiles once", async () => {
    const loaded: string[] = [];
    const profiles: string[] = [];
    const saved: SavedDraft = { message: 'Canonical project follow-up', mode: 'general', model: 'saved-model', quickAction: null, attachments: [] };
    let reads = 0;
    const detail = request('r1');
    const app = mount({ props: { preferredProjectId: '', requestId: undefined }, echoScope: true,
      persistence: { load: async key => { loaded.push(key); return key === 'p1:s1' ? saved : null; },
        save: async () => assert.fail('Do not transfer an empty temporary draft over the canonical one'), remove: async () => assert.fail('Do not delete drafts on read') },
      sessionApi: { fetchTestSession: async () => { reads += 1; return session('s1', { currentRequestId: 'r1', requests: [detail] }); } },
      qaApi: { fetchQaRunnerProfiles: async project => { profiles.push(project); return []; } },
    });
    await tick();
    assert.equal(app.state.projectId.value, 'p1');
    assert.equal(app.state.request.value?.id, 'r1');
    assert.equal(app.state.message.value, saved.message);
    assert.deepEqual(loaded, [':s1', 'p1:s1']);
    assert.deepEqual(profiles, ['p1']);
    assert.equal(reads, 1, 'Echoing the inferred scope must not reset the current request');
    assert.deepEqual(app.notifications, [{ projectId: 'p1', sessionId: 's1', requestId: undefined }]);
    assert.ok(app.calls.every(call => call.startsWith('GET')));
  });

  it("preserves an explicit historical request while inferring the session project", async () => {
    const old = request('old'); const current = request('current');
    const app = mount({ props: { preferredProjectId: '', requestId: old.id }, echoScope: true,
      sessionApi: { fetchTestSession: async () => session('s1', { currentRequestId: current.id, requests: [old, current] }) },
      qaApi: { fetchQaRequest: async (_project, id) => id === old.id ? old : current },
    });
    await tick();
    assert.equal(app.state.request.value?.id, old.id);
    assert.equal(app.state.viewingPast.value, true);
    assert.equal(app.notifications.at(-1)?.requestId, old.id);
    assert.equal(app.state.canStart.value, false);
    assert.ok(app.calls.every(call => call.startsWith('GET')));
  });

  it("rejects an explicit wrong project or unlinked request before displaying session data", async () => {
    for (const props of [{ preferredProjectId: 'wrong-project' }, { requestId: 'unlinked' }]) {
      const app = mount({ props, sessionApi: { fetchTestSession: async () => session() } });
      await tick();
      assert.equal(app.state.session.value, null);
      assert.equal(app.state.request.value, null);
      assert.equal(app.state.readError.value, 'testSessions.errors.scope');
      assert.equal(app.state.blocked.value, true);
      assert.equal(app.state.canStart.value, false);
      assert.equal(app.notifications.length, 0);
      assert.ok(app.calls.every(call => call.startsWith('GET')));
    }
  });

  it("keeps owned detail-read failures blocked and recovers only on an explicit retry", async () => {
    for (const failure of ['Session not found', 'temporarily offline']) {
      let fail = true;
      const app = mount({ props: { preferredProjectId: '' }, sessionApi: {
        fetchTestSession: async () => { if (fail) throw new Error(failure); return session('s1', { projectId: '' }); },
      } });
      await tick();
      assert.equal(app.state.session.value, null);
      assert.equal(app.state.readError.value, failure);
      assert.equal(app.state.blocked.value, true);
      await app.state.send(); await app.state.prepare();
      assert.deepEqual(app.calls, []);
      fail = false; await app.state.refresh();
      assert.equal((app.state.session.value as TestSessionDetail | null)?.id, 's1');
      assert.equal(app.state.readError.value, '');
      assert.equal(app.notifications.length, 0);
    }
  });

  it("canonicalizes inferred scope once after an explicit retry recovers the linked request", async () => {
    let fail = true;
    const profiles: string[] = [];
    const app = mount({ props: { preferredProjectId: '', requestId: 'r1' }, echoScope: true,
      sessionApi: { fetchTestSession: async () => session('s1', { currentRequestId: 'r1', requests: [request()] }) },
      qaApi: { fetchQaRequest: async () => { if (fail) throw new Error('Request read failed'); return request(); },
        fetchQaRunnerProfiles: async project => { profiles.push(project); return []; } },
    });
    await tick();
    assert.equal(app.state.projectId.value, 'p1');
    assert.equal(app.state.readError.value, 'Request read failed');
    assert.equal(app.notifications.length, 0);
    fail = false; await app.state.refresh(); await tick();
    assert.equal(app.state.request.value?.id, 'r1');
    assert.equal(app.state.readError.value, '');
    assert.deepEqual(app.notifications, [{ projectId: 'p1', sessionId: 's1', requestId: 'r1' }]);
    await app.state.refresh();
    assert.equal(app.notifications.length, 1);
    assert.deepEqual(profiles, ['p1']);
    assert.ok(app.calls.every(call => call.startsWith('GET')));
  });

  it("ignores a late inferred project after newer navigation and a late profile after owner change", async () => {
    const read = deferred<TestSessionDetail>();
    const app = mount({ props: { preferredProjectId: '' }, sessionApi: { fetchTestSession: () => read.promise } });
    await tick();
    app.props.preferredProjectId = 'p2'; app.props.sessionId = undefined; await tick();
    read.resolve(session()); await tick();
    assert.equal(app.state.projectId.value, 'p2');
    assert.equal(app.state.session.value, null);
    assert.equal(app.notifications.length, 0);

    const profiles = deferred<QaRunnerProfile[]>();
    const other = mount({ props: { preferredProjectId: '' }, qaApi: { fetchQaRunnerProfiles: () => profiles.promise } });
    await tick();
    assert.equal(other.state.profilesLoading.value, true);
    other.props.currentUser = { ...other.props.currentUser!, id: 'owner-b' };
    other.props.preferredProjectId = ''; other.props.sessionId = undefined; await tick();
    profiles.resolve([{ id: 'private-profile', status: 'ONLINE' } as QaRunnerProfile]); await tick();
    assert.deepEqual(other.state.profiles.value, []);
    assert.equal(other.state.profilesLoading.value, false);
    assert.equal(other.state.session.value, null);
  });

  it("uses the same projectless home draft key on initial mount and return", async () => {
    const app = mount({ props: { preferredProjectId: '', sessionId: undefined } });
    await tick();
    app.state.message.value = 'Unsent home draft';
    app.props.preferredProjectId = 'p2'; await tick();
    assert.equal(app.state.message.value, '');
    app.state.message.value = 'Project draft';
    app.props.preferredProjectId = ''; await tick();
    assert.equal(app.state.message.value, 'Unsent home draft');
    app.props.preferredProjectId = 'p2'; await tick();
    assert.equal(app.state.message.value, 'Project draft');
    assert.ok(app.calls.every(call => call.startsWith('GET')), 'Selecting a draft never creates a session or QA request');
  });

  it("only reads on selection, refresh, and reactivation; never auto-prepares or runs", async () => {
    const app = mount({ sessionApi: { fetchTestSession: async () => session("s1", { pendingProposal: proposal() }) } });
    await tick();
    assert.equal(app.state.canPrepare.value, true);
    await app.state.refresh();
    app.deactivate(); app.activate(); await tick();
    assert.ok(app.calls.every(call => call.startsWith("GET")));
    assert.equal(app.notifications.length, 0);
  });

  it("preserves unscoped text when creating a project and restores separate project drafts", async () => {
    const app = mount({ props: { preferredProjectId: "", sessionId: undefined } });
    app.state.message.value = "Keep my requirements";
    await app.state.newProject("New project");
    assert.equal(app.state.projectId.value, "created-project");
    assert.equal(app.state.message.value, "Keep my requirements");
    app.props.preferredProjectId = "p2"; app.props.sessionId = undefined; await tick();
    assert.equal(app.state.message.value, "");
    app.state.message.value = "Other requirements";
    await app.state.chooseProject("created-project");
    assert.equal(app.state.message.value, "Keep my requirements");
    assert.equal(app.state.busy.value, false);
  });

  it("preserves both a saved project draft and a separate unscoped draft, including files and model", async () => {
    const app = mount({ props: { sessionId: undefined } });
    await tick();
    const savedFile = new File(["saved project context"], "project.txt", { type: "text/plain" });
    const unscopedFile = new File(["new unscoped context"], "unscoped.txt", { type: "text/plain" });
    app.state.message.value = "Saved project requirements";
    app.state.model.value = "saved-model";
    app.state.selectedAttachments.value = [{ file: savedFile, name: savedFile.name, mimeType: savedFile.type, type: "file" }];
    await app.state.chooseProject("");
    app.state.message.value = "Separate unscoped requirements";
    app.state.model.value = "unscoped-model";
    app.state.selectedAttachments.value = [{ file: unscopedFile, name: unscopedFile.name, mimeType: unscopedFile.type, type: "file" }];
    await app.state.chooseProject("p1");
    assert.equal(app.state.message.value, "Saved project requirements");
    assert.equal(app.state.model.value, "saved-model");
    assert.equal(app.state.selectedAttachments.value[0]?.file, savedFile);
    await app.state.chooseProject("");
    assert.equal(app.state.message.value, "Separate unscoped requirements");
    assert.equal(app.state.model.value, "unscoped-model");
    assert.equal(app.state.selectedAttachments.value[0]?.file, unscopedFile);
    // A genuinely new destination still receives the unscoped draft intact.
    await app.state.chooseProject("p2");
    assert.equal(app.state.message.value, "Separate unscoped requirements");
    assert.equal(app.state.selectedAttachments.value[0]?.file, unscopedFile);
    await app.state.chooseProject("p1");
    assert.equal(app.state.message.value, "Saved project requirements");
    assert.equal(app.state.selectedAttachments.value[0]?.file, savedFile);
  });

  it("restores a project draft persisted before this mount without overwriting either private draft", async () => {
    const projectFile = new File(['Project context'], 'project.txt', { type: 'text/plain' });
    const unsentFile = new File(['Unscoped context'], 'unscoped.txt', { type: 'text/plain' });
    const projectDraft: SavedDraft = { message: 'Previous project draft', mode: 'test-cases', model: 'saved-model', quickAction: null,
      attachments: [{ file: projectFile, name: projectFile.name, mimeType: projectFile.type, type: 'file' }] };
    const rows = new Map<string, SavedDraft>([['p1:new', projectDraft]]);
    const app = mount({ props: { preferredProjectId: '', sessionId: undefined }, persistence: {
      load: async key => rows.get(key) || null,
      save: async (key, value) => { rows.set(key, value); }, remove: async key => { rows.delete(key); },
    } });
    await tick();
    app.state.message.value = 'Independent unscoped draft';
    app.state.model.value = 'unscoped-model';
    app.state.selectedAttachments.value = [{ file: unsentFile, name: unsentFile.name, mimeType: unsentFile.type, type: 'file' }];
    await app.state.chooseProject('p1'); await tick();
    assert.equal(app.state.message.value, projectDraft.message);
    assert.equal(app.state.mode.value, 'test-cases');
    assert.equal(app.state.model.value, 'saved-model');
    assert.equal(app.state.selectedAttachments.value[0]?.file, projectFile);
    assert.equal(rows.get('p1:new')?.message, projectDraft.message);
    assert.equal(rows.get(':new')?.message, 'Independent unscoped draft');
    await app.state.chooseProject('');
    assert.equal(app.state.message.value, 'Independent unscoped draft');
    assert.equal(app.state.selectedAttachments.value[0]?.file, unsentFile);
    assert.equal(app.state.model.value, 'unscoped-model');
  });

  it("does not transfer or change scope when the destination draft cannot be read", async () => {
    const rows = new Map<string, SavedDraft>();
    const app = mount({ props: { preferredProjectId: '', sessionId: undefined }, persistence: {
      load: async key => { if (key === 'p1:new') throw new Error('IndexedDB unavailable'); return null; },
      save: async (key, value) => { rows.set(key, value); }, remove: async () => assert.fail('Do not delete the source draft'),
    } });
    await tick(); app.state.message.value = 'Keep this private draft';
    await app.state.chooseProject('p1');
    assert.equal(app.state.projectId.value, '');
    assert.equal(app.state.message.value, 'Keep this private draft');
    assert.equal(app.state.error.value, 'sessions.draftStorage');
    assert.equal(app.state.busy.value, false);
    assert.equal(rows.has('p1:new'), false);
    assert.deepEqual(app.notifications, []);
  });

  it("ignores a delayed destination draft after navigation or an account round trip", async () => {
    for (const changeOwner of [false, true]) {
      const saved = deferred<SavedDraft | null>();
      let destinationReads = 0;
      const app = mount({ props: { preferredProjectId: '', sessionId: undefined }, persistence: {
        load: async key => key === 'p1:new' && ++destinationReads === 1 ? saved.promise : null,
        save: async () => {}, remove: async () => {},
      } });
      await tick(); app.state.message.value = 'Original unscoped draft';
      const choosing = app.state.chooseProject('p1');
      if (changeOwner) {
        const owner = app.props.currentUser!;
        app.props.currentUser = { ...owner, id: 'owner-b' };
        app.props.currentUser = owner;
      } else app.props.preferredProjectId = 'p2';
      await tick();
      saved.resolve({ message: 'Delayed old draft', mode: 'general', model: 'old-model', quickAction: null, attachments: [] });
      await choosing; await tick();
      assert.equal(app.state.projectId.value, changeOwner ? '' : 'p2');
      assert.equal(app.state.message.value, '');
      assert.deepEqual(app.notifications, []);
      if (changeOwner) {
        await app.state.chooseProject('p1');
        assert.equal(app.state.message.value, '');
      }
      app.dispose();
    }
  });

  it("keeps the latest project selection when destination reads finish out of order", async () => {
    const first = deferred<SavedDraft | null>();
    const second = deferred<SavedDraft | null>();
    const app = mount({ props: { preferredProjectId: '', sessionId: undefined }, persistence: {
      load: async key => key === 'p1:new' ? first.promise : key === 'p2:new' ? second.promise : null,
      save: async () => {}, remove: async () => {},
    } });
    await tick(); app.state.message.value = 'Carry my draft';
    const choosingFirst = app.state.chooseProject('p1');
    const choosingSecond = app.state.chooseProject('p2');
    first.resolve(null); await choosingFirst;
    assert.equal(app.state.projectId.value, '');
    second.resolve(null); await choosingSecond;
    assert.equal(app.state.projectId.value, 'p2');
    assert.equal(app.state.message.value, 'Carry my draft');
    assert.equal(app.state.busy.value, false);
  });

  it("preserves a session draft through record history, hiding, and project switches", async () => {
    const saved = session("s1", { currentRequestId: "r2", requests: [request("r1"), request("r2")] });
    const app = mount({ sessionApi: { fetchTestSession: async () => saved } });
    await tick();
    app.state.message.value = "Unsent follow-up";
    await app.state.selectRequest("r1");
    assert.equal(app.state.message.value, "Unsent follow-up");
    app.deactivate(); app.activate(); await tick();
    assert.equal(app.state.message.value, "Unsent follow-up");
    await app.state.chooseProject("p2");
    app.props.sessionId = "s1"; app.props.requestId = "r1";
    await tick();
    assert.equal(app.state.message.value, "Unsent follow-up");
  });

  it("moves an open session to its confirmed project with the same draft, attachment and canonical scope", async () => {
    const file = new File(['Private context'], 'context.txt', { type: 'text/plain' });
    const rows = new Map<string, SavedDraft>();
    let saved = session();
    const writes: unknown[] = [];
    const app = mount({ echoScope: true, persistence: {
      load: async key => rows.get(key) || null,
      save: async (key, value) => { rows.set(key, value); }, remove: async key => { rows.delete(key); },
    }, sessionApi: { fetchTestSession: async () => saved, updateTestSession: async (projectId, id, input) => {
      writes.push({ projectId, id, input }); saved = { ...saved, projectId: input.projectId, version: 2 }; return saved;
    } } });
    await tick();
    app.state.message.value = 'Unsent while moving';
    app.state.selectedAttachments.value = [{ file, name: file.name, mimeType: file.type, type: 'file' }];
    await app.state.chooseProject('p2'); await tick();
    assert.equal(app.state.projectId.value, 'p2');
    assert.equal(app.state.session.value?.id, 's1');
    assert.equal(app.state.message.value, 'Unsent while moving');
    assert.equal(app.state.selectedAttachments.value[0]?.file, file);
    assert.equal(app.state.busy.value, false); assert.equal(app.state.qaActionBusy.value, false);
    assert.equal(app.state.readError.value, '');
    assert.equal(rows.has('p1:s1'), false);
    assert.equal(rows.get('p2:s1')?.message, 'Unsent while moving');
    assert.deepEqual(app.notifications, [{ projectId: 'p2', sessionId: 's1', requestId: undefined }]);
    assert.equal(writes.length, 1);
    assert.ok(!app.calls.some(call => /POST|UPLOAD/.test(call)));
  });

  it("blocks a project move before the server mutation when the destination has a private draft", async () => {
    const rows = new Map<string, SavedDraft>([['p2:s1', { message: 'Earlier destination draft', mode: 'general', model: 'saved-model', quickAction: null, attachments: [] }]]);
    const app = mount({ persistence: {
      load: async key => rows.get(key) || null,
      save: async (key, value) => { rows.set(key, value); }, remove: async () => assert.fail('No draft removal'),
    } });
    await tick(); app.state.message.value = 'Current source draft';
    await app.state.chooseProject('p2');
    assert.equal(app.state.projectId.value, 'p1');
    assert.equal(app.state.message.value, 'Current source draft');
    assert.equal(app.state.error.value, 'sessions.draftMoveConflict');
    assert.equal(rows.get('p2:s1')?.message, 'Earlier destination draft');
    assert.ok(!app.calls.includes('PATCH session'));
  });

  it("does not follow a moved session after navigation during draft persistence", async () => {
    const saving = deferred<void>();
    let started = false;
    const app = mount({ persistence: { load: async () => null,
      save: async key => { if (key === 'p2:s1') { started = true; await saving.promise; } }, remove: async () => {} } });
    await tick(); app.state.message.value = 'Keep with moved session';
    const moving = app.state.applyProjectMove(session('s1', { projectId: 'p2', version: 2 }), 'p1');
    await tick(); assert.equal(started, true);
    app.props.sessionId = 's2'; await tick(); app.state.message.value = 'Separate session';
    saving.resolve(); await moving;
    assert.equal(app.state.session.value?.id, 's2');
    assert.equal(app.state.projectId.value, 'p1');
    assert.equal(app.state.message.value, 'Separate session');
    assert.deepEqual(app.notifications, []);
  });

  it("rejects delayed move drafts after an account round trip", async () => {
    const loading = deferred<SavedDraft | null>();
    let reads = 0;
    const app = mount({ persistence: { load: async key => key === 'p2:s1' && ++reads === 1 ? loading.promise : null,
      save: async () => {}, remove: async () => assert.fail('No cross-owner draft deletion') } });
    await tick(); app.state.message.value = 'Owner A';
    const moving = app.state.applyProjectMove(session('s1', { projectId: 'p2' }), 'p1');
    await tick();
    const owner = app.props.currentUser!;
    app.props.currentUser = { ...owner, id: 'owner-b' }; app.props.currentUser = owner;
    loading.resolve(null);
    await assert.rejects(moving, /sessions.draftMoveConflict/);
    assert.equal(app.state.projectId.value, 'p1');
    assert.equal(app.state.message.value, '');
    assert.deepEqual(app.notifications, []);
  });

  it("clears both private drafts and retained session data immediately on owner change", async () => {
    const delayed = deferred<TestSessionDetail>();
    let reads = 0;
    const app = mount({ sessionApi: { fetchTestSession: async () => ++reads === 1 ? session() : delayed.promise } });
    await tick();
    app.state.message.value = "Private owner A text";
    app.props.currentUser = { ...app.props.currentUser!, id: "owner-b" };
    assert.equal(app.state.message.value, "");
    assert.equal(app.state.session.value, null);
    app.props.sessionId = 'owner-b-session';
    delayed.resolve(session("owner-b-session")); await tick();
    assert.equal((app.state.session.value as TestSessionDetail | null)?.id, "owner-b-session");
  });

  it("retries a failed turn using the same session, uploaded asset, and client turn identity", async () => {
    const inputs: TestTurnInput[] = [];
    let uploads = 0;
    const app = mount({ props: { sessionId: undefined }, echoScope: true,
      upload: async () => { uploads += 1; return { requestAttachments: [{ assetId: "asset-1" }] }; },
      sessionApi: { sendTestTurn: async (_projectId, id, input) => {
        inputs.push(structuredClone(input));
        if (inputs.length === 1) throw new Error("Connection lost after POST");
        return session(id, { version: 2 });
      } },
    });
    await tick(); app.state.message.value = "Test checkout";
    await app.state.send();
    assert.equal(app.state.message.value, "Test checkout");
    assert.equal(app.state.error.value, "Connection lost after POST");
    app.props.preferredProjectId = "p2"; app.props.sessionId = undefined;
    await tick();
    app.props.preferredProjectId = "p1"; app.props.sessionId = "created";
    await tick();
    await app.state.send();
    assert.equal(app.calls.filter(call => call === "POST session").length, 1);
    assert.equal(uploads, 1);
    assert.deepEqual(inputs[1], inputs[0]);
    assert.equal(app.state.message.value, "");
  });

  it("preserves uncertain session-create identity across navigation without duplicate creation", async () => {
    const keys: string[] = [];
    const app = mount({ props: { sessionId: undefined }, sessionApi: { createTestSession: async (_project, input) => {
      keys.push(input.clientSessionId);
      if (keys.length === 1) throw new Error("Lost create response");
      return session("created");
    } } });
    await tick(); app.state.message.value = "Test login";
    await app.state.send();
    await app.state.chooseProject("p2"); await app.state.chooseProject("p1");
    await app.state.send();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  });

  it("recovers an already-created session after its response arrived on another project", async () => {
    const created = deferred<TestSessionDetail>();
    let creates = 0;
    const app = mount({ props: { sessionId: undefined }, sessionApi: { createTestSession: () => { creates += 1; return created.promise; } } });
    await tick(); app.state.message.value = "Test billing";
    const sending = app.state.send();
    await app.state.chooseProject("p2");
    const notified = app.notifications.length;
    created.resolve(session("created")); await sending;
    assert.equal(app.notifications.length, notified);
    assert.equal(app.state.session.value, null);
    await app.state.chooseProject("p1"); await app.state.send();
    assert.equal(creates, 1);
    assert.equal((app.state.session.value as TestSessionDetail | null)?.id, "created");
  });

  it("blocks hidden actions reactively and never navigates on a hidden send completion", async () => {
    const turn = deferred<TestSessionDetail>();
    const app = mount({ sessionApi: { sendTestTurn: () => turn.promise } });
    await tick();
    assert.equal(app.state.blocked.value, false);
    app.state.message.value = "Test login";
    const sending = app.state.send(); await tick();
    app.deactivate();
    turn.resolve(session("s1", { version: 2 })); await sending;
    assert.equal(app.state.blocked.value, true);
    assert.equal(app.state.busy.value, false);
    assert.equal(app.notifications.length, 0);
    assert.equal(app.timers.size, 0);
    assert.equal(app.state.message.value, "");
    app.activate(); await tick();
    assert.equal(app.state.blocked.value, false);
    app.props.active = false;
    assert.equal(app.state.blocked.value, true);
    await app.state.update({ title: "Hidden write" });
    assert.ok(!app.calls.includes("PATCH session"));
  });

  it("does not start a follow-on turn while hidden and reuses a completed upload on return", async () => {
    const upload = deferred<{ requestAttachments: { assetId: string }[] }>();
    let uploads = 0;
    const app = mount({ upload: () => { uploads += 1; return upload.promise; } });
    await tick(); app.state.message.value = "Use attached screenshot";
    const sending = app.state.send(); await tick();
    app.deactivate();
    upload.resolve({ requestAttachments: [{ assetId: "image-1" }] }); await sending;
    assert.ok(!app.calls.includes("POST turn"));
    app.activate(); await tick(); await app.state.send();
    assert.equal(uploads, 1);
    assert.equal(app.calls.filter(call => call === "POST turn").length, 1);
  });

  it("keeps delete failures visible without refreshing or navigating away", async () => {
    const app = mount({ sessionApi: { deleteTestSession: async () => { throw new Error("Delete rejected"); } } });
    await tick(); const before = [...app.calls];
    await app.state.removeDraft();
    assert.equal(app.state.session.value?.id, "s1");
    assert.equal(app.state.error.value, "Delete rejected");
    assert.deepEqual(app.calls, before);
    assert.equal(app.notifications.length, 0);
  });

  it("deletes successfully without reloading the removed session or retaining its local draft", async () => {
    const app = mount(); await tick();
    app.state.message.value = "Unsent deleted draft";
    const reads = app.calls.filter(call => call === "GET session s1").length;
    await app.state.removeDraft();
    assert.equal(app.state.session.value, null);
    assert.equal(app.state.message.value, "");
    assert.equal(app.state.readError.value, "");
    assert.equal(app.calls.filter(call => call === "GET session s1").length, reads);
    assert.deepEqual(app.notifications.at(-1), { projectId: "p1", sessionId: undefined, requestId: undefined });
  });

  it("does not navigate a different project after a stale delete completes", async () => {
    const deletion = deferred<{ ok: boolean }>();
    const app = mount({ sessionApi: { deleteTestSession: () => deletion.promise } });
    await tick(); const removing = app.state.removeDraft();
    app.props.preferredProjectId = "p2"; app.props.sessionId = undefined; await tick();
    const before = app.notifications.length;
    deletion.resolve({ ok: true }); await removing;
    assert.equal(app.state.projectId.value, "p2");
    assert.equal(app.notifications.length, before);
  });

  it("allows explicit deletion of an unlinked draft with messages but never a linked QA record", async () => {
    const app = mount({ sessionApi: { fetchTestSession: async () => session("s1", { messages: [{ id: "m1", role: "user", content: "Unprepared draft", createdAt: "now", model: null }] }) } });
    await tick();
    await app.state.removeDraft();
    assert.equal(app.calls.filter(call => call === "DELETE session").length, 1);
    assert.equal(app.state.session.value, null);
    app.state.session.value = session("linked", { currentRequestId: "r1", requests: [request()] });
    await app.state.removeDraft();
    assert.equal(app.calls.filter(call => call === "DELETE session").length, 1);
    assert.equal(app.state.session.value.id, "linked");
    app.state.session.value = session("busy", { turnStatus: { id: "turn", status: "PROCESSING", errorCode: null } });
    await app.state.removeDraft();
    assert.equal(app.calls.filter(call => call === "DELETE session").length, 1);
  });

  it("does not prepare or start a historical record while the session's current request is running", async () => {
    const old = request("old", { phase: "APPROVED" });
    const running = request("current", { phase: "RUNNING" });
    const saved = session("s1", { currentRequestId: running.id, requests: [old, running], pendingProposal: proposal() });
    const app = mount({ props: { requestId: old.id }, sessionApi: { fetchTestSession: async () => saved }, qaApi: { fetchQaRequest: async () => old } });
    await tick();
    assert.equal(app.state.viewingPast.value, true);
    assert.equal(app.state.canPrepare.value, false);
    app.state.request.value = request("old", { phase: "READY_TO_RUN", selectedArtifactId: "artifact" });
    assert.equal(app.state.canStart.value, false);
    await app.state.prepare(); await app.state.startExternal(true);
    assert.ok(!app.calls.includes("POST prepare"));
    assert.equal(app.timers.size, 1);
  });

  it("prepares only the server proposal on an explicit click and never starts a run", async () => {
    const saved = session("s1", { pendingProposal: proposal() });
    const inputs: unknown[] = [];
    const app = mount({ sessionApi: {
      fetchTestSession: async () => saved,
      prepareTestSession: async (_project, _id, input) => { inputs.push(input); return saved; },
    } });
    await tick();
    assert.equal(inputs.length, 0);
    await app.state.prepare();
    assert.deepEqual(inputs, [{ expectedSessionVersion: 1, proposalId: "proposal-1" }]);
  });

  it("retains a queued review receipt and polling when the next detail read fails", async () => {
    const failedReview = { id: "review-1", status: "FAILED" as const, summary: null, suggestions: [], createdAt: "now", completedAt: null };
    const detail = request("r1", { executionRecipes: [recipe({ assessments: [failedReview] })] });
    let reads = 0;
    let retries = 0;
    const receipt = { operationId: "op-1", requestId: "r1", recipeId: "recipe-1", kind: "EXECUTION_RECIPE_REVIEW", status: "PENDING" };
    const app = mount({ props: { requestId: "r1" }, sessionApi: { fetchTestSession: async () => session("s1", { currentRequestId: "r1", requests: [detail] }) }, qaApi: {
      fetchQaRequest: async () => { if (++reads > 1) throw new Error("Read temporarily unavailable"); return detail; },
      retryQaExecutionRecipeReview: async () => { retries += 1; return receipt; },
    } });
    await tick();
    await app.state.retryReview({ recipeId: "recipe-1", assessmentId: "stale" });
    assert.equal(retries, 0);
    await app.state.retryReview({ recipeId: "recipe-1", assessmentId: "review-1" });
    assert.equal(retries, 1);
    assert.deepEqual(app.state.request.value?.operations, [receipt]);
    assert.equal(app.state.error.value, "");
    assert.equal(app.timers.size, 1);
  });

  it("rejects old profile and detail responses after a newer project was selected", async () => {
    const oldRequest = deferred<QaRequestDetail>();
    const oldProfiles = deferred<QaRunnerProfile[]>();
    const app = mount({ props: { requestId: "r1" }, sessionApi: { fetchTestSession: async () => session('s1', { currentRequestId: 'r1', requests: [request()] }) }, qaApi: {
      fetchQaRequest: () => oldRequest.promise,
      fetchQaRunnerProfiles: (project: string) => project === "p1" ? oldProfiles.promise : Promise.resolve([]),
    } });
    await tick();
    app.props.preferredProjectId = "p2"; app.props.sessionId = undefined; app.props.requestId = undefined; await tick();
    oldRequest.resolve(request("stale")); oldProfiles.resolve([{ id: "stale", status: "ONLINE" } as QaRunnerProfile]);
    await tick();
    assert.equal(app.state.request.value, null);
    assert.deepEqual(app.state.profiles.value, []);
    assert.equal(app.state.loading.value, false);
    assert.equal(app.state.profilesLoading.value, false);
    assert.equal(app.notifications.length, 0); // Explicit route changes are not echoed as mutations.
  });

  it("never starts, selects, or generates for historical records even when current work is idle", async () => {
    const past = request("old", { phase: "CHANGES_REQUESTED", selectedArtifactId: "artifact", executionRecipes: [recipe()] });
    const current = request("current", { phase: "APPROVED" });
    const app = mount({ props: { requestId: past.id }, sessionApi: { fetchTestSession: async () => session("s1", { currentRequestId: current.id, requests: [past, current] }) }, qaApi: { fetchQaRequest: async () => past } });
    await tick();
    assert.equal(app.state.canStart.value, false);
    await app.state.startExternal(true);
    app.state.request.value = { ...past, selectedArtifactId: null, artifacts: [{ id: "artifact", requestId: past.id, revision: 1, origin: "ODDPATH_GENERATED", title: "Checklist", lockedAt: null, createdAt: "now", assessments: [], items: [] }] };
    assert.equal(app.state.canSelect.value, false);
    await app.state.selectArtifact();
  });

  it("retains newer unsent text when the previous turn finishes and does not resend it", async () => {
    const turn = deferred<TestSessionDetail>();
    const inputs: TestTurnInput[] = [];
    const app = mount({ sessionApi: { sendTestTurn: (_project, _id, input) => { inputs.push(structuredClone(input)); return turn.promise; } } });
    await tick(); app.state.message.value = "First message";
    const sending = app.state.send(); await tick();
    app.state.message.value = "New unsent message";
    turn.resolve(session("s1", { version: 2 })); await sending;
    assert.equal(app.state.message.value, "New unsent message");
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.content, "First message");
  });

  it("does not notify scope after a mutation's refresh was superseded by navigation", async () => {
    const reload = deferred<TestSessionDetail>();
    let reads = 0;
    const app = mount({ props: { requestId: "r1" }, sessionApi: { fetchTestSession: async () => ++reads === 1 ? session("s1", { currentRequestId: "r1", requests: [request()] }) : reload.promise }, qaApi: {
      fetchQaRequest: async () => request("r1", { selectedArtifactId: "artifact" }),
      startQaRun: async () => ({ request: request("r1", { phase: "RUNNING", selectedArtifactId: "artifact" }) }),
    } });
    await tick(); const starting = app.state.startExternal(true); await tick();
    app.props.preferredProjectId = "p2"; app.props.sessionId = undefined; app.props.requestId = undefined; await tick(); const before = app.notifications.length;
    reload.resolve(session("s1")); await starting;
    assert.equal(app.state.projectId.value, "p2");
    assert.equal(app.notifications.length, before);
  });
});

describe("Test session preparation presentation", () => {
  it("rejects unresolved current preparation even when viewing a settled historical request", () => {
    const old = request("old", { phase: "APPROVED" });
    const current = request("current", { phase: "READY_TO_RUN" });
    assert.equal(presentation.testSessionCanPrepare(session("s1", { currentRequestId: current.id, requests: [old, current], pendingProposal: proposal() }), old), false);
    assert.equal(presentation.testSessionCanPrepare(session("s1", { currentRequestId: old.id, requests: [old], pendingProposal: proposal() }), old), true);
  });

  it("exports system activity as inert assistant text, without workflow authority", () => {
    const exported = presentation.testSessionTranscript(session("s1", { messages: [{ id: "m1", role: "system", content: "Run recorded", model: null, createdAt: "now" }] }), "Informational export only");
    assert.equal(exported.messages[0]?.content, "Informational export only");
    assert.equal(exported.messages[1]?.role, "assistant");
    assert.match(exported.messages[1]!.content, /Recorded activity/);
    assert.equal("pendingProposal" in exported, false);
  });
});

function proposal(): NonNullable<TestSessionDetail["pendingProposal"]> {
  return { id: "proposal-1", title: "Login", objective: "Check login", target: null, environment: null, acceptanceNotes: null, sourceMessageIds: ["m1"], ready: true };
}
function session(id = "s1", changes: Partial<TestSessionDetail> = {}): TestSessionDetail {
  return { id, projectId: "p1", title: "New Test", version: 1, archivedAt: null, createdAt: "now", updatedAt: "now", currentRequestId: null,
    requests: [], messages: [], pendingProposal: null, turnStatus: null, preparation: null, ...changes };
}
function request(id = "r1", changes: Partial<QaRequestDetail> = {}): QaRequestDetail {
  return { id, projectId: "p1", title: "Request", objective: "Test login", phase: "READY_TO_RUN", version: 1, createdAt: "now", updatedAt: "now",
    target: null, environment: null, acceptanceNotes: null, selectedArtifactId: null, artifacts: [], runs: [], operations: [], contextSnapshots: [], reviews: [], events: [], ...changes };
}
function recipe(changes: Partial<QaExecutionRecipe> = {}): QaExecutionRecipe {
  return { id: "recipe-1", requestId: "r1", artifactId: "artifact", revision: 1, origin: "ODDPATH_GENERATED", title: "Login steps",
    schemaVersion: 1, executorKey: "playwright", recipeHash: "a".repeat(64), bundle: { schemaVersion: 1, engine: "playwright", items: [] },
    profileManifest: null, profileManifestHash: null, supersedesRecipeId: null, items: [], assessments: [], createdAt: "now", ...changes };
}
