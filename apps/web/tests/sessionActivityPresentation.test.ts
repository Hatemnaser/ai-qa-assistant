import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import type { QaOperationReceipt, QaRequestDetail, QaRequestSummary, QaRun } from "../src/features/qa/types";
import type { TestSessionDetail } from "../src/features/test-sessions/types";
import * as presentation from "../src/features/sessions/sessionActivityPresentation";

const time = "2026-10-04T10:00:00.000Z";
const summary = (id: string, phase: QaRequestSummary["phase"] = "READY_FOR_REVIEW"): QaRequestSummary => ({
  id, projectId: "project", title: id, objective: "Test only", phase, version: 1, createdAt: time, updatedAt: time,
});
function request(id = "current", phase: QaRequestSummary["phase"] = "READY_FOR_REVIEW"): QaRequestDetail {
  return { ...summary(id, phase), target: null, environment: null, acceptanceNotes: null, selectedArtifactId: null,
    contextSnapshots: [], artifacts: [], executionRecipes: [], operations: [], runs: [], reviews: [], events: [] };
}
function session(requests: QaRequestSummary[] = [summary("current")]): TestSessionDetail {
  return { id: "session", projectId: "project", title: "Session", version: 1, archivedAt: null, createdAt: time,
    updatedAt: time, currentRequestId: requests[0]?.id || null, requests, messages: [], events: [], pendingProposal: null,
    preparation: null, turnStatus: null };
}
const operation = (overrides: Partial<QaOperationReceipt> = {}): QaOperationReceipt => ({
  operationId: "operation", requestId: "current", kind: "EXECUTION_RECIPE_REVIEW", status: "SUCCEEDED", ...overrides,
});
const run = (overrides: Partial<QaRun> = {}): QaRun => ({
  id: "run", requestId: "current", artifactId: "artifact", status: "RESULTS_SUBMITTED", outcome: "FAIL", version: 1,
  sourceLabel: null, externalRunRef: null, commitSha: null, startedAt: time, submittedAt: time, createdAt: time,
  updatedAt: time, results: [], evidence: [], ...overrides,
});
function event(id: string, sequence: number, position: number | null, requestId = "current") {
  return { id, requestId, title: requestId, type: "CHECK_RESULT_RECORDED", sequence,
    timelinePosition: position, createdAt: time, metadata: null };
}
const all = (activity: ReturnType<typeof presentation.sessionActivityPresentation>) => [...activity.active, ...activity.attention, ...activity.completed];

describe("session activity is an honest, read-only projection", () => {
  it("keeps a current running request separate from a historical approved request", () => {
    const saved = session([summary("current", "RUNNING"), summary("historical", "APPROVED")]);
    const old = request("historical", "APPROVED");
    old.runs = [run({ id: "old-run", requestId: "historical", outcome: "FAIL" })];
    const result = presentation.sessionActivityPresentation({ session: saved, request: old });
    assert.equal(result.currentRequestId, "current");
    assert.equal(result.selectedRequestId, "historical");
    assert.equal(result.active[0]?.requestId, "current");
    assert.equal(result.active[0]?.current, true);
    assert.equal(result.active[0]?.viewed, false);
    assert.equal(result.completed.find(item => item.id === "request:historical")?.viewed, true);
    assert.equal(result.completed.find(item => item.id === "run:old-run")?.outcome, "FAIL");
    assert.equal(result.active[0]?.progress, null, "do not fetch or infer detail for the running request");
  });

  it("does not turn completed execution with failed checks into passed QA", () => {
    const detail = request(); detail.runs = [run()];
    const before = JSON.stringify(detail);
    const result = presentation.sessionActivityPresentation({ session: session(), request: detail });
    assert.equal(result.completed.find(item => item.kind === "run")?.statusKey, "sessionTools.activity.state.completed");
    assert.equal(result.completed.find(item => item.kind === "run")?.outcome, "FAIL");
    assert.equal(result.attention.find(item => item.kind === "request")?.statusKey, "projects.qa.focus.phase.READY_FOR_REVIEW");
    assert.equal(JSON.stringify(detail), before);
  });

  it("exposes evidence needed, changes requested and processing errors as attention", () => {
    const phases: QaRequestSummary["phase"][] = ["DRAFT", "READY_TO_RUN", "EVIDENCE_NEEDED", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "PROCESSING_FAILED"];
    const result = presentation.sessionActivityPresentation({ session: session(phases.map(phase => summary(phase, phase))), request: null });
    assert.equal(result.attention.length, phases.length);
    assert.equal(result.active.length, 0);
    assert.equal(result.completed.length, 0);
  });

  it("supports an unlinked record without creating a session", () => {
    const detail = request("legacy", "APPROVED");
    const result = presentation.sessionActivityPresentation({ session: null, request: detail });
    assert.equal(result.currentRequestId, "legacy");
    assert.equal(result.completed[0]?.id, "request:legacy");
    assert.equal(result.requests.length, 1);
  });

  it("ignores late detail from another project or a request outside the session", () => {
    for (const detail of [request("other"), { ...request(), projectId: "other-project" }]) {
      detail.runs = [run()]; detail.operations = [operation()];
      const result = presentation.sessionActivityPresentation({ session: session(), request: detail });
      assert.equal(result.selectedRequestId, null);
      assert.equal(all(result).length, 1);
    }
  });

  it("ignores operations and runs with a foreign request identity", () => {
    const detail = request(); detail.operations = [operation({ requestId: "foreign" })]; detail.runs = [run({ requestId: "foreign" })];
    assert.equal(all(presentation.sessionActivityPresentation({ session: session(), request: detail })).length, 1);
  });

  it("deduplicates each persisted source identity without collapsing distinct attempts", () => {
    const detail = request(); detail.operations = [operation(), operation(), operation({ operationId: "second" })];
    detail.runs = [run(), run()];
    const saved = session([summary("current"), summary("current")]);
    const result = presentation.sessionActivityPresentation({ session: saved, request: detail });
    assert.equal(result.requests.length, 1);
    assert.deepEqual(result.completed.filter(item => item.kind === "operation").map(item => item.id), ["operation:operation", "operation:second"]);
    assert.equal(result.completed.filter(item => item.kind === "run").length, 1);
  });

  it("shows a conversation turn alongside QA without inventing a start or end time", () => {
    const saved = session([summary("current", "RUNNING")]);
    saved.turnStatus = { id: "turn", status: "PROCESSING", errorCode: null };
    saved.preparation = { id: "preparation", requestId: "current", status: "READY", recipeId: "recipe", operationId: "op", runnerRegistrationId: null, profileKey: null, errorCode: null };
    const result = presentation.sessionActivityPresentation({ session: saved, request: null });
    assert.equal(result.active.find(item => item.kind === "assistant")?.timestamp, null);
    assert.equal(result.completed.find(item => item.kind === "preparation")?.timestamp, null);
    assert.equal(result.active.find(item => item.kind === "assistant")?.requestId, null);
    assert.equal(saved.messages.length, 0);
  });

  it("retains failed conversation and preparation with actual error codes", () => {
    const saved = session(); saved.turnStatus = { id: "turn", status: "FAILED", errorCode: "PROVIDER_UNCERTAIN" };
    saved.preparation = { id: "preparation", requestId: "current", status: "FAILED", recipeId: null, operationId: null,
      runnerRegistrationId: null, profileKey: null, errorCode: "QA_PROVIDER_FAILED" };
    const result = presentation.sessionActivityPresentation({ session: saved, request: null });
    assert.equal(result.attention.find(item => item.kind === "assistant")?.errorCode, "PROVIDER_UNCERTAIN");
    assert.equal(result.attention.find(item => item.kind === "preparation")?.errorCode, "QA_PROVIDER_FAILED");
  });

  it("shows an infrastructure failure separately from test outcome", () => {
    const detail = request("current", "READY_TO_RUN");
    detail.runs = [run({ status: "ACTIVE", outcome: "INCOMPLETE", executionJob: {
      id: "job", runId: "run", recipeId: "recipe", runnerRegistrationId: "runner", profileKey: "profile", status: "FAILED",
      completedItems: 1, totalItems: 4, failureCode: "RUNNER_ERROR", failureMessage: null, createdAt: time, updatedAt: time,
    } })];
    const item = presentation.sessionActivityPresentation({ session: session(), request: detail }).attention.find(row => row.kind === "run");
    assert.equal(item?.errorCode, "RUNNER_ERROR");
    assert.equal(item?.outcome, "INCOMPLETE");
    assert.equal(item?.statusKey, "sessionTools.activity.state.failed");
    assert.deepEqual(item?.progress, { completed: 1, total: 4 });
  });

  it("does not fabricate progress when counts are missing or inconsistent", () => {
    const detail = request();
    for (const [completedItems, totalItems] of [[0, 0], [8, 4], [-1, 4], [1.5, 3]]) {
      detail.runs = [run({ status: "ACTIVE", outcome: "NOT_RUN", executionJob: {
        id: "job", runId: "run", recipeId: "recipe", runnerRegistrationId: "runner", profileKey: "profile", status: "RUNNING",
        completedItems, totalItems, failureCode: null, failureMessage: null, createdAt: time, updatedAt: time,
      } })];
      const item = presentation.sessionActivityPresentation({ session: session(), request: detail }).active.find(row => row.kind === "run");
      assert.equal(item?.progress, null);
      assert.equal(item?.outcome, "NOT_RUN");
    }
  });

  it("ignores a job scoped to another run", () => {
    const detail = request(); detail.runs = [run({ status: "ACTIVE", executionJob: {
      id: "job", runId: "another-run", recipeId: "recipe", runnerRegistrationId: "runner", profileKey: "profile", status: "FAILED",
      completedItems: 3, totalItems: 5, failureCode: "FOREIGN", failureMessage: null, createdAt: time, updatedAt: time,
    } })];
    const item = presentation.sessionActivityPresentation({ session: session(), request: detail }).active.find(row => row.kind === "run");
    assert.equal(item?.errorCode, null);
    assert.equal(item?.progress, null);
  });

  it("uses only genuine, valid timestamps and no fallback clock for operation receipts", () => {
    const detail = request(); detail.operations = [operation({ availableAt: time }), operation({ operationId: "invalid", completedAt: "bad date" })];
    const result = presentation.sessionActivityPresentation({ session: session(), request: detail });
    assert.ok(result.completed.filter(item => item.kind === "operation").every(item => item.timestamp === null));
    detail.operations[0]!.completedAt = time;
    assert.equal(presentation.sessionActivityPresentation({ session: session(), request: detail }).completed.find(item => item.id === "operation:operation")?.timestamp, time);
  });

  it("retains all original event identities in authoritative order, including routine entries", () => {
    const saved = session(); saved.events = [event("results", 3, 3), event("check", 2, 2), event("start", 1, 1)];
    const detail = request(); detail.events = [{ ...event("check", 2, null), actorKind: "USER", transport: "WEB" }];
    const before = JSON.stringify(saved);
    const result = presentation.sessionActivityPresentation({ session: saved, request: detail });
    assert.deepEqual(result.events.map(item => item.id), ["start", "check", "results"]);
    assert.equal(result.events.find(item => item.id === "check")?.timelinePosition, 2);
    assert.equal(JSON.stringify(saved), before);
  });

  it("keeps legacy event sequence without creating timestamps or assistant messages", () => {
    const saved = session(); saved.events = [event("z", 1, null), event("a", 2, null)];
    assert.deepEqual(presentation.sessionActivityPresentation({ session: saved, request: null }).events.map(item => item.id), ["z", "a"]);
    assert.equal(saved.messages.length, 0);
  });

  it("keeps reading errors and loading explicit while leaving original state immutable", () => {
    const saved = session(); const detail = request(); const before = JSON.stringify({ saved, detail });
    const result = presentation.sessionActivityPresentation({ session: saved, request: detail, loading: true, readError: true });
    assert.equal(result.loading, true); assert.equal(result.readError, true); assert.equal(result.requests.length, 1);
    assert.equal(JSON.stringify({ saved, detail }), before);
  });

  it("localizes known event labels without silently hiding unknown events or failures", () => {
    assert.equal(presentation.qaEventLabelKey("RUN_RESULTS_SUBMITTED"), "sessionTools.events.runResultsSubmitted");
    assert.equal(presentation.qaEventLabelKey("run_results_submitted"), "sessionTools.events.runResultsSubmitted");
    assert.equal(presentation.qaEventLabelKey("FUTURE_EVENT"), "sessionTools.events.recorded");
    assert.equal(presentation.isPrimarySessionEvent("check_result_recorded"), false);
    assert.equal(presentation.isPrimarySessionEvent("EVIDENCE_ADDED"), false);
    for (const type of ["REQUEST_CREATED", "RUN_STARTED", "HUMAN_REVIEW_RECORDED", "EXECUTION_FAILED", "CHECKLIST_ASSESSMENT_FAILED", "FUTURE_EVENT"]) {
      assert.equal(presentation.isPrimarySessionEvent(type), true);
    }
  });
});

const source = await readFile(new URL("../src/features/sessions/SessionActivityPanel.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const script = transpileModule(compileScript(descriptor, { id: "session-activity" }).content, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
const scopes: vue.EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));
type Props = { session: TestSessionDetail | null; request: QaRequestDetail | null; loading?: boolean; readError?: string; disabled?: boolean };
type State = { selectRequest(id: string): void; activity: vue.ComputedRef<ReturnType<typeof presentation.sessionActivityPresentation>> };
function mount(initial: Props) {
  const props = vue.reactive(initial);
  const modules: Record<string, unknown> = { vue, "./sessionActivityPresentation": presentation,
    "../../i18n/useI18n": { useI18n: () => ({ t: (key: string) => key, formatDate: (date: string) => date }) } };
  const module = { exports: {} as { default: { setup(props: unknown, context: unknown): State } } };
  new Function("require", "exports", script)((id: string) => { assert.ok(id in modules, id); return modules[id]; }, module.exports);
  const calls: unknown[][] = []; const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => module.exports.default.setup(props, { expose: () => {}, emit: (...args: unknown[]) => calls.push(args) }))!;
  return { props, state, calls };
}

describe("activity panel actions are explicit and read-safe", () => {
  it("emits only a known request selection after a deliberate click", () => {
    const { state, calls } = mount({ session: session(), request: request() });
    assert.deepEqual(calls, []);
    state.selectRequest("unknown"); assert.deepEqual(calls, []);
    state.selectRequest("current"); assert.deepEqual(calls, [["select-request", "current"]]);
  });

  it("blocks stale action targets while loading, errored or disabled and resumes after retry", () => {
    const { props, state, calls } = mount({ session: session(), request: request(), loading: true });
    state.selectRequest("current"); props.loading = false; props.readError = "network";
    state.selectRequest("current"); props.readError = ""; props.disabled = true;
    state.selectRequest("current"); assert.deepEqual(calls, []);
    props.disabled = false; state.selectRequest("current"); assert.deepEqual(calls, [["select-request", "current"]]);
  });

  it("stops exposing the previous owner's entries when parent scope clears them", () => {
    const { props, state, calls } = mount({ session: session(), request: request() });
    props.session = null; props.request = null;
    assert.equal(state.activity.value.requests.length, 0);
    state.selectRequest("current"); assert.deepEqual(calls, []);
  });

  it("has no mutation or request dependencies and preserves full history behind native details", () => {
    assert.doesNotMatch(source, /fetch\(|qaApi|sessionApi|v-html|setInterval|startRun|prepareTest/);
    assert.match(descriptor.template!.content, /activity\.events/);
    assert.match(descriptor.template!.content, /:disabled="interactionsBlocked"/);
    assert.match(descriptor.template!.content, /item\.outcome/);
    assert.match(descriptor.template!.content, /role="alert"/);
    assert.match(descriptor.template!.content, /session-activity__technical/);
  });
});
