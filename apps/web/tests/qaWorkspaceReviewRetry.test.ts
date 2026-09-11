import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import * as harness from "../src/features/qa/harnessPresentation.ts";
import type { QaOperationReceipt, QaRequestDetail, QaRequestSummary, QaRunnerProfile } from "../src/features/qa/types.ts";
import * as i18n from "../src/i18n/useI18n.ts";

interface WorkspaceState {
  selectedProjectId: vue.Ref<string>;
  selectedRequest: vue.Ref<QaRequestDetail | null>;
  isRetryingRecipeReview: vue.Ref<boolean>;
  errorMessage: vue.Ref<string>;
  successMessage: vue.Ref<string>;
  operationGroups: vue.ComputedRef<ReturnType<typeof harness.qaOperationGroups>>;
  requests: vue.Ref<QaRequestSummary[]>;
  runnerProfiles: vue.Ref<QaRunnerProfile[]>;
  isLoading: vue.Ref<boolean>;
  isLoadingRequest: vue.Ref<boolean>;
  isLoadingProfiles: vue.Ref<boolean>;
  isMutating: vue.Ref<boolean>;
  loadWorkspace(): Promise<void>;
  loadRunnerProfiles(): Promise<void>;
  openRequest(request: QaRequestSummary): Promise<void>;
  mutate(action: () => Promise<QaRequestDetail>, success: string): Promise<boolean>;
  retryRecipeReview(input: { recipeId: string; assessmentId: string }): Promise<void>;
}

const source = await readFile(new URL("../src/features/qa/QaWorkspacePage.vue", import.meta.url), "utf8");
const script = transpileModule(compileScript(parse(source).descriptor, { id: "qa-workspace-review-retry-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const retryInput = { recipeId: "recipe-1", assessmentId: "failed-review-1" };

describe("QA Workspace review retry coordination", () => {
  it("renders latest processing separately from retained earlier attempts", () => {
    const { state } = mountWorkspace({});
    const failed = { ...operation(), operationId: "earlier", status: "FAILED" as const, errorCode: "AI_PROVIDER_REQUEST_REJECTED" };
    const succeeded = { ...failed, operationId: "latest", status: "SUCCEEDED" as const, errorCode: null };
    state.selectedRequest.value!.operations = [succeeded, failed];
    assert.deepEqual(state.operationGroups.value, { current: [succeeded], earlier: [failed] });
    const template = parse(source).descriptor.template!.content;
    assert.match(template, /v-for="operation in operationGroups.current"/);
    assert.match(template, /<details v-if="operationGroups.earlier.length" :key="selectedRequest\?\.id"/);
    assert.match(template, /v-for="operation in operationGroups.earlier"/);
    assert.match(template, /qaOperationPresentation\(operation, true\)/);
    assert.doesNotMatch(template, /visibleOperations/);
  });

  it("attaches the operation immediately and retains polling if assessment reload fails", async () => {
    const receipt = operation();
    const reload = deferred<QaRequestDetail>();
    const { state, scheduledPolls } = mountWorkspace({
      retryQaExecutionRecipeReview: async () => receipt,
      fetchQaRequest: () => reload.promise,
    });

    const work = state.retryRecipeReview(retryInput);
    assert.equal(state.isRetryingRecipeReview.value, true);
    await Promise.resolve();
    assert.deepEqual(state.selectedRequest.value?.operations, [receipt]);
    assert.equal(harness.qaRecipeReviewState(state.selectedRequest.value!.executionRecipes![0]!, [receipt]).canRetry, false);
    reload.reject(new Error("Temporary read failure"));
    await work;

    assert.equal(state.isRetryingRecipeReview.value, false);
    assert.deepEqual(state.selectedRequest.value?.operations, [receipt]);
    assert.equal(state.errorMessage.value, "");
    assert.equal(scheduledPolls.length, 1);
  });

  it("reloads the new assessment without changing the immutable Recipe", async () => {
    const detail = request();
    detail.executionRecipes![0]!.assessments.unshift({
      id: "pending-review-2", status: "PENDING", summary: null, suggestions: [],
      createdAt: "2026-09-08T00:01:00Z", completedAt: null,
    });
    detail.operations = [operation()];
    const { state } = mountWorkspace({
      retryQaExecutionRecipeReview: async () => operation(),
      fetchQaRequest: async () => detail,
    });
    const initialRecipe = state.selectedRequest.value!.executionRecipes![0]!;
    await state.retryRecipeReview(retryInput);
    const refreshedRecipe = state.selectedRequest.value!.executionRecipes![0]!;
    assert.equal(refreshedRecipe.id, initialRecipe.id);
    assert.equal(refreshedRecipe.recipeHash, initialRecipe.recipeHash);
    assert.equal(refreshedRecipe.assessments[0]!.id, "pending-review-2");
    assert.equal(refreshedRecipe.assessments[1]!.status, "FAILED");
    assert.equal(harness.qaRecipeReviewState(refreshedRecipe, detail.operations).isReviewed, false);
  });

  it("does not replace a newly selected request with a delayed enqueue response", async () => {
    const enqueue = deferred<QaOperationReceipt>();
    let reloads = 0;
    const { state } = mountWorkspace({
      retryQaExecutionRecipeReview: () => enqueue.promise,
      fetchQaRequest: async () => { reloads += 1; return request(); },
    });
    const work = state.retryRecipeReview(retryInput);
    state.selectedRequest.value = request("new-request");
    enqueue.resolve(operation());
    await work;
    assert.equal(state.selectedRequest.value.id, "new-request");
    assert.equal(reloads, 0);
    assert.equal(state.successMessage.value, "");
    assert.equal(state.isRetryingRecipeReview.value, false);
  });

  it("does not replace a newly selected request with a delayed assessment reload", async () => {
    const reload = deferred<QaRequestDetail>();
    const { state } = mountWorkspace({
      retryQaExecutionRecipeReview: async () => operation(),
      fetchQaRequest: () => reload.promise,
    });
    const work = state.retryRecipeReview(retryInput);
    await Promise.resolve();
    state.selectedRequest.value = request("new-request");
    reload.resolve(request());
    await work;
    assert.equal(state.selectedRequest.value.id, "new-request");
    assert.equal(state.isRetryingRecipeReview.value, false);
  });

  it("rejects stale and concurrent clicks locally and clears busy state after an enqueue error", async () => {
    const enqueue = deferred<QaOperationReceipt>();
    let calls = 0;
    const { state } = mountWorkspace({
      retryQaExecutionRecipeReview: () => { calls += 1; return enqueue.promise; },
    });
    await state.retryRecipeReview({ ...retryInput, assessmentId: "stale-review" });
    assert.equal(calls, 0);
    const work = state.retryRecipeReview(retryInput);
    await state.retryRecipeReview(retryInput);
    assert.equal(calls, 1);
    enqueue.reject(new Error("Retry unavailable"));
    await work;
    assert.equal(state.isRetryingRecipeReview.value, false);
    assert.equal(state.errorMessage.value, "Retry unavailable");
    assert.deepEqual(state.selectedRequest.value?.operations, []);
  });
});

describe("QA Workspace response ownership", () => {
  it("loads exactly once when mounted with an already loaded account and project", async () => {
    let listCalls = 0;
    let detailCalls = 0;
    const { state, dispose } = mountWorkspace({
      fetchQaRequests: async () => { listCalls += 1; return [request()]; },
      fetchProjectConnections: async () => [],
      fetchQaRunnerProfiles: async () => [],
      fetchQaRequest: async () => { detailCalls += 1; return request(); },
    }, true, true);
    try {
      // Let Vue's real immediate/project watchers and their async loads settle.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(state.selectedProjectId.value, "project-1");
      assert.equal(listCalls, 1);
      assert.equal(detailCalls, 1);
      assert.equal(state.selectedRequest.value?.id, "request-1");
      assert.equal(state.isLoading.value, false);
    } finally {
      dispose();
    }
  });

  it("keeps the displayed request when it is selected again before another detail finishes", async () => {
    const delayed = deferred<QaRequestDetail>();
    let detailCalls = 0;
    const { state } = mountWorkspace({
      fetchQaRequest: () => { detailCalls += 1; return delayed.promise; },
    }, true);
    const current = state.selectedRequest.value!;
    const loadingOther = state.openRequest(request("other-request"));
    assert.equal(state.isLoadingRequest.value, true);
    await state.openRequest(current);
    assert.equal(state.isLoadingRequest.value, false);
    delayed.resolve(request("other-request"));
    await loadingOther;
    assert.equal(state.selectedRequest.value?.id, current.id);
    assert.equal(detailCalls, 1);
    assert.equal(state.isLoadingRequest.value, false);
    assert.equal(state.errorMessage.value, "");
  });

  for (const sample of [false, true]) {
    it(`discards a late ${sample ? "sample" : "detail"} response after switching projects`, async () => {
      const delayed = deferred<QaRequestDetail>();
      const loadingDetail = deferred<void>();
      const old = request("old-request");
      const current = { ...request("current-request"), projectId: "project-2" };
      const detail = (projectId: string) => {
        if (projectId === "project-1") { loadingDetail.resolve(); return delayed.promise; }
        return Promise.resolve(current);
      };
      const { state } = mountWorkspace({
        fetchQaRequests: async (projectId: string) => sample ? [] : [projectId === "project-1" ? old : current],
        fetchProjectConnections: async () => [], fetchQaRunnerProfiles: async () => [],
        fetchQaRequest: detail, fetchQaSample: detail,
      }, true);
      const oldLoad = state.loadWorkspace();
      await loadingDetail.promise;
      state.selectedProjectId.value = "project-2";
      await state.loadWorkspace();
      assert.equal(state.selectedRequest.value?.id, current.id);
      delayed.resolve(old);
      await oldLoad;
      assert.equal(state.selectedRequest.value?.projectId, "project-2");
      assert.equal(state.isLoading.value, false);
    });
  }

  it("does not restore an old mutation response after selecting another request", async () => {
    const delayed = deferred<QaRequestDetail>();
    const current = request("other-request");
    const { state } = mountWorkspace({
      fetchQaRequest: async () => current,
      fetchQaRequests: async () => { assert.fail("A stale mutation must not refresh the request list."); },
    }, true);
    const mutation = state.mutate(() => delayed.promise, "Old action succeeded");
    await state.openRequest(current);
    delayed.resolve(request());
    assert.equal(await mutation, false);
    assert.equal(state.selectedRequest.value?.id, current.id);
    assert.equal(state.isMutating.value, false);
    assert.equal(state.successMessage.value, "");
  });

  it("discards a delayed mutation list refresh after navigation", async () => {
    const summaries = deferred<QaRequestSummary[]>();
    const loadingList = deferred<void>();
    const current = request("other-request");
    const { state } = mountWorkspace({
      fetchQaRequests: () => { loadingList.resolve(); return summaries.promise; },
      fetchQaRequest: async () => current,
    }, true);
    const mutation = state.mutate(async () => request(), "Old success");
    await loadingList.promise;
    await state.openRequest(current);
    summaries.resolve([request()]);
    assert.equal(await mutation, false);
    assert.deepEqual(state.requests.value, []);
    assert.equal(state.selectedRequest.value?.id, current.id);
    assert.equal(state.successMessage.value, "");
  });

  it("does not let an older A response win after navigating A to B to A", async () => {
    const delayed = deferred<QaRequestDetail>();
    const old = request();
    const { state } = mountWorkspace({ fetchQaRequest: async (_projectId: string, id: string) => request(id) }, true);
    const mutation = state.mutate(() => delayed.promise, "Old success");
    await state.openRequest(request("other-request"));
    await state.openRequest(old);
    delayed.resolve({ ...old, title: "Stale title" });
    assert.equal(await mutation, false);
    assert.equal(state.selectedRequest.value?.title, "QA Request");
  });

  it("discards mutation errors after an account switch", async () => {
    const delayed = deferred<QaRequestDetail>();
    const { state, props } = mountWorkspace({}, true);
    const mutation = state.mutate(() => delayed.promise, "Old success");
    props.currentUser = { id: "new-owner" };
    delayed.reject(new Error("Old account error"));
    assert.equal(await mutation, false);
    assert.equal(state.errorMessage.value, "");
    assert.equal(state.isMutating.value, false);
  });

  it("discards old profile discovery after switching project", async () => {
    const profiles = deferred<QaRunnerProfile[]>();
    const { state } = mountWorkspace({ fetchQaRunnerProfiles: () => profiles.promise }, true);
    const refresh = state.loadRunnerProfiles();
    state.selectedProjectId.value = "project-2";
    profiles.resolve([{ key: "stale" } as QaRunnerProfile]);
    await refresh;
    assert.deepEqual(state.runnerProfiles.value, []);
    assert.equal(state.isLoadingProfiles.value, false);
  });

  it("does not apply responses or schedule polling after unmount", async () => {
    const delayed = deferred<QaRequestDetail>();
    const { state, dispose, scheduledPolls } = mountWorkspace({}, true);
    const mutation = state.mutate(() => delayed.promise, "Old success");
    dispose();
    delayed.resolve({ ...request(), title: "Unmounted response" });
    assert.equal(await mutation, false);
    assert.equal(state.selectedRequest.value?.title, "QA Request");
    assert.equal(scheduledPolls.length, 0);
  });
});

function mountWorkspace(api: Record<string, unknown>, signedIn = false, liveWatchers = false) {
  const scheduledPolls: Array<() => void> = [];
  let dispose = () => {};
  const modules: Record<string, unknown> = {
    // Most tests isolate async handlers. Mount/load tests opt into real Vue
    // watchers so initial selection and scheduling are covered too.
    vue: { ...vue, watch: liveWatchers ? vue.watch : () => () => {}, onBeforeUnmount: (callback: () => void) => { dispose = callback; } },
    "../../i18n/useI18n": i18n,
    "../assets/assetsApi": {},
    "./components/QaConnectionModal.vue": {},
    "./components/QaPlaywrightRunModal.vue": {},
    "./components/QaRequestFormModal.vue": {},
    "./harnessPresentation": harness,
    "./qaApi": api,
  };
  const module = { exports: {} as { default?: { setup: (props: unknown, context: unknown) => WorkspaceState } } };
  new Function("require", "exports", "window", script)((id: string) => {
    assert.ok(id in modules, `Unexpected Workspace dependency: ${id}`);
    return modules[id];
  }, module.exports, {
    setTimeout: (callback: () => void) => scheduledPolls.push(callback),
    clearTimeout: () => {},
  });
  const props = vue.reactive<{ currentUser: { id: string } | null; projects: unknown[] }>({
    currentUser: signedIn ? { id: "owner-1" } : null,
    projects: liveWatchers ? [{ id: "project-1", name: "Existing project" }] : [],
  });
  const scope = vue.effectScope();
  const state = scope.run(() => module.exports.default!.setup(props, { expose: () => {}, emit: () => {} }))!;
  if (!liveWatchers) {
    state.selectedProjectId.value = "project-1";
    state.selectedRequest.value = request();
  }
  return { state, scheduledPolls, props, dispose: () => { dispose(); scope.stop(); } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function operation(): QaOperationReceipt {
  return { operationId: "review-operation-1", requestId: "request-1", recipeId: "recipe-1", kind: "EXECUTION_RECIPE_REVIEW", status: "PENDING" };
}

function request(id = "request-1"): QaRequestDetail {
  return {
    id, projectId: "project-1", title: "QA Request", objective: "Check login", phase: "READY_TO_RUN", version: 1,
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", target: null, environment: null,
    acceptanceNotes: null, selectedArtifactId: "artifact-1", contextSnapshots: [], runs: [], reviews: [], events: [], operations: [],
    artifacts: [{ id: "artifact-1", requestId: id, title: "Checklist", revision: 1, origin: "ODDPATH_GENERATED", assessments: [], items: [], lockedAt: null, createdAt: "2026-09-08T00:00:00Z" }],
    executionRecipes: [{
      id: "recipe-1", requestId: id, artifactId: "artifact-1", title: "Recipe", revision: 1, origin: "ODDPATH_GENERATED",
      schemaVersion: 1, executorKey: "playwright", recipeHash: "a".repeat(64), bundle: { schemaVersion: 1, engine: "playwright", items: [] },
      profileManifest: null, profileManifestHash: "b".repeat(64), supersedesRecipeId: null, items: [], createdAt: "2026-09-08T00:00:00Z",
      assessments: [{ id: "failed-review-1", status: "FAILED", summary: null, suggestions: [], createdAt: "2026-09-08T00:00:00Z", completedAt: null }],
    }],
  };
}
