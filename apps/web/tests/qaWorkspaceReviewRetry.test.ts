import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import * as harness from "../src/features/qa/harnessPresentation.ts";
import * as presentation from "../src/features/qa/workspacePresentation.ts";
import type { CreateQaRequestInput, QaOperationReceipt, QaRequestDetail, QaRequestSummary, QaRun, QaRunnerProfile } from "../src/features/qa/types.ts";
import * as i18n from "../src/i18n/useI18n.ts";

interface WorkspaceState {
  selectedProjectId: vue.Ref<string>;
  selectedRequest: vue.Ref<QaRequestDetail | null>;
  isRetryingRecipeReview: vue.Ref<boolean>;
  errorMessage: vue.Ref<string>;
  requestModalError: vue.Ref<string>;
  successMessage: vue.Ref<string>;
  operationGroups: vue.ComputedRef<ReturnType<typeof harness.qaOperationGroups>>;
  currentOperations: vue.ComputedRef<QaOperationReceipt[]>;
  completedOperations: vue.ComputedRef<QaOperationReceipt[]>;
  nextAction: vue.ComputedRef<ReturnType<typeof presentation.qaWorkspaceNextAction>>;
  requests: vue.Ref<QaRequestSummary[]>;
  runnerProfiles: vue.Ref<QaRunnerProfile[]>;
  isLoading: vue.Ref<boolean>;
  isLoadingRequest: vue.Ref<boolean>;
  isLoadingProfiles: vue.Ref<boolean>;
  isMutating: vue.Ref<boolean>;
  isRunModalOpen: vue.Ref<boolean>;
  isRequestListOpen: vue.Ref<boolean>;
  recordRef: vue.Ref<HTMLElement | null>;
  loadWorkspace(): Promise<void>;
  loadRunnerProfiles(): Promise<void>;
  scheduleHarnessPoll(): void;
  openRequest(request: QaRequestSummary): Promise<void>;
  refreshSelectedRequest(): Promise<void>;
  openStoredEvidence(assetId: string): Promise<void>;
  handleNextAction(): Promise<void>;
  saveRequest(input: CreateQaRequestInput): Promise<void>;
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
    assert.deepEqual(state.currentOperations.value, []);
    assert.deepEqual(state.completedOperations.value, [succeeded]);
    const template = parse(source).descriptor.template!.content;
    assert.match(template, /v-for="operation in currentOperations"/);
    assert.match(template, /v-for="operation in completedOperations"/);
    assert.match(template, /v-for="operation in operationGroups.earlier"/);
    assert.match(template, /qaOperationPresentation\(operation, true\)/);
    assert.doesNotMatch(template, /visibleOperations/);
  });

  it("keeps unfinished operations and unrecovered errors visible rather than hiding them in history", () => {
    const { state } = mountWorkspace({});
    const pending = { ...operation(), operationId: "pending", status: "PENDING" as const };
    const failed = { ...operation(), operationId: "latest-failure", recipeId: "other-recipe", status: "FAILED" as const };
    const oldFailure = { ...failed, operationId: "previous-failure" };
    state.selectedRequest.value!.operations = [pending, failed, oldFailure];
    assert.deepEqual(state.currentOperations.value, [pending, failed]);
    assert.deepEqual(state.completedOperations.value, []);
    assert.deepEqual(state.operationGroups.value.earlier, [oldFailure]);
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

describe("QA Workspace focused actions", () => {
  it("opens preparation without generating a Recipe or starting an execution", async () => {
    let discoveries = 0;
    const { state } = mountWorkspace({
      fetchQaRunnerProfiles: async () => { discoveries += 1; return []; },
      generateQaExecutionRecipe: () => assert.fail("Opening preparation must not generate a Recipe."),
      retryQaExecutionRecipeReview: () => assert.fail("Opening preparation must not retry a review."),
      startQaRun: () => assert.fail("Opening preparation must not execute anything."),
    }, true);
    assert.equal(state.nextAction.value.action, "prepare");
    await state.handleNextAction();
    assert.equal(state.isRunModalOpen.value, true);
    assert.equal(discoveries, 1);
  });

  it("does not dispatch a stale next action while loading another request or mutating", async () => {
    const { state } = mountWorkspace({ fetchQaRunnerProfiles: () => assert.fail("Busy record must not open preparation.") }, true);
    for (const flag of [state.isLoadingRequest, state.isMutating]) {
      flag.value = true;
      assert.equal(state.nextAction.value.action, null);
      assert.equal(state.nextAction.value.disabled, true);
      await state.handleNextAction();
      assert.equal(state.isRunModalOpen.value, false);
      flag.value = false;
    }
  });

  it("refreshes the selected detail and summary together without changing request identity", async () => {
    const fresh = { ...request(), title: "Updated results", version: 2 };
    let detailCalls = 0;
    let listCalls = 0;
    const { state } = mountWorkspace({
      fetchQaRequest: async (projectId: string, requestId: string) => {
        detailCalls += 1;
        assert.equal(projectId, "project-1");
        assert.equal(requestId, fresh.id);
        return fresh;
      },
      fetchQaRequests: async () => { listCalls += 1; return [fresh]; },
    }, true);
    await state.refreshSelectedRequest();
    assert.equal(state.selectedRequest.value?.title, "Updated results");
    assert.equal(state.requests.value[0]?.version, 2);
    assert.equal(state.isLoadingRequest.value, false);
    assert.equal(detailCalls, 1);
    assert.equal(listCalls, 1);
  });

  it("rejects duplicate refresh clicks and leaves the existing record visible on read failure", async () => {
    const delayed = deferred<QaRequestDetail>();
    let detailCalls = 0;
    const { state } = mountWorkspace({
      fetchQaRequest: () => { detailCalls += 1; return delayed.promise; },
      fetchQaRequests: async () => [],
    }, true);
    const refreshing = state.refreshSelectedRequest();
    await state.refreshSelectedRequest();
    assert.equal(detailCalls, 1);
    assert.equal(state.isLoadingRequest.value, true);
    delayed.reject(new Error("Read unavailable"));
    await refreshing;
    assert.equal(state.errorMessage.value, "Read unavailable");
    assert.equal(state.selectedRequest.value?.title, "QA Request");
    assert.equal(state.isLoadingRequest.value, false);
  });

  it("does not replace the next action with a read-error state for an unrelated action failure", () => {
    const { state } = mountWorkspace({}, true);
    state.errorMessage.value = "Evidence could not be opened";
    assert.equal(state.nextAction.value.action, "prepare");
    assert.equal(state.nextAction.value.titleKey, "projects.qa.focus.next.preparingTitle");
  });

  it("retries the requested detail after a selection read fails, not the older displayed record", async () => {
    const requestedIds: string[] = [];
    const other = request("other-request");
    const { state } = mountWorkspace({
      fetchQaRequest: async (_projectId: string, requestId: string) => {
        requestedIds.push(requestId);
        if (requestedIds.length === 1) throw new Error("Other request temporarily unavailable");
        return request(requestId);
      },
      fetchQaRequests: async () => [request(), other],
    }, true);
    await state.openRequest(other);
    assert.equal(state.selectedRequest.value?.id, "request-1");
    assert.equal(state.nextAction.value.action, "refresh");
    await state.refreshSelectedRequest();
    assert.deepEqual(requestedIds, ["other-request", "other-request"]);
    assert.equal(state.selectedRequest.value?.id, other.id);
    assert.equal(state.errorMessage.value, "");
  });

  it("clears the old failed-selection recovery when a different request is successfully created", async () => {
    const requestedIds: string[] = [];
    const created = { ...request("created-request"), phase: "GENERATING" as const, artifacts: [], selectedArtifactId: null };
    const { state } = mountWorkspace({
      fetchQaRequest: async (_projectId: string, requestId: string) => {
        requestedIds.push(requestId);
        if (requestId === "failed-request") throw new Error("B read failed");
        return created;
      },
      fetchQaRequests: async () => [created, request()],
      createQaRequest: async () => ({ request: created, operation: null }),
    }, true);
    await state.openRequest(request("failed-request"));
    assert.equal(state.nextAction.value.titleKey, "projects.qa.focus.next.loadFailedTitle");
    await state.saveRequest({ title: "New test", objective: "Verify another flow", checklistMode: "ODDPATH_GENERATED" });
    assert.equal(state.selectedRequest.value?.id, created.id);
    assert.equal(state.errorMessage.value, "");
    assert.equal(state.nextAction.value.titleKey, "projects.qa.focus.next.generatingTitle");
    await state.refreshSelectedRequest();
    assert.deepEqual(requestedIds, ["failed-request", "created-request"]);
  });

  it("preserves the failed-selection recovery if creating a different request fails", async () => {
    const requestedIds: string[] = [];
    const failedSelection = request("failed-request");
    const { state } = mountWorkspace({
      fetchQaRequest: async (_projectId: string, requestId: string) => {
        requestedIds.push(requestId);
        if (requestedIds.length === 1) throw new Error("B read failed");
        return failedSelection;
      },
      fetchQaRequests: async () => [failedSelection, request()],
      createQaRequest: async () => { throw new Error("C creation failed"); },
    }, true);
    await state.openRequest(failedSelection);
    await state.saveRequest({ title: "New test", objective: "Verify another flow", checklistMode: "ODDPATH_GENERATED" });
    assert.equal(state.selectedRequest.value?.id, "request-1");
    assert.equal(state.errorMessage.value, "B read failed");
    assert.equal(state.requestModalError.value, "C creation failed");
    assert.equal(state.nextAction.value.titleKey, "projects.qa.focus.next.loadFailedTitle");
    await state.refreshSelectedRequest();
    assert.deepEqual(requestedIds, ["failed-request", "failed-request"]);
    assert.equal(state.selectedRequest.value?.id, failedSelection.id);
  });

  it("restores focus to the sample record after closing the mobile test list", async () => {
    let focusCalls = 0;
    const { state } = mountWorkspace({ fetchQaRequest: () => assert.fail("Sample selection is read-only.") }, true);
    const sample = { ...request("sample-request"), sample: true };
    state.selectedRequest.value = sample;
    state.isRequestListOpen.value = true;
    state.recordRef.value = { focus: () => { focusCalls += 1; } } as unknown as HTMLElement;
    await state.openRequest(sample);
    assert.equal(state.isRequestListOpen.value, false);
    assert.equal(focusCalls, 1);
  });

  it("keeps failed selection recovery scoped to B while polling updates displayed A", async () => {
    const requestedIds: string[] = [];
    let otherAttempts = 0;
    const other = request("other-request");
    const refreshedCurrent = { ...request(), title: "Refreshed A", operations: [{ ...operation(), status: "SUCCEEDED" as const }] };
    const { state, scheduledPolls } = mountWorkspace({
      fetchQaRequest: async (_projectId: string, requestId: string) => {
        requestedIds.push(requestId);
        if (requestId === other.id && otherAttempts++ === 0) throw new Error("B read failed");
        return requestId === other.id ? other : refreshedCurrent;
      },
      fetchQaOperation: async () => ({ ...operation(), status: "SUCCEEDED" as const }),
      fetchQaRequests: async () => [refreshedCurrent, other],
    }, true);
    state.selectedRequest.value!.operations = [operation()];
    await state.openRequest(other);
    state.scheduleHarnessPoll();
    scheduledPolls.at(-1)!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.selectedRequest.value?.title, "Refreshed A");
    assert.equal(state.errorMessage.value, "B read failed");
    assert.equal(state.nextAction.value.titleKey, "projects.qa.focus.next.loadFailedTitle");
    await state.handleNextAction();
    assert.deepEqual(requestedIds, ["other-request", "request-1", "other-request"]);
    assert.equal(state.selectedRequest.value?.id, other.id);
    assert.equal(state.errorMessage.value, "");
  });

  for (const boundary of ["request", "project", "account", "unmount"] as const) {
    it(`rejects a delayed refresh across the ${boundary} boundary`, async () => {
      const delayed = deferred<QaRequestDetail>();
      const { state, props, dispose } = mountWorkspace({
        fetchQaRequest: () => delayed.promise,
        fetchQaRequests: async () => [{ ...request(), title: "Old summary" }],
      }, true);
      const refreshing = state.refreshSelectedRequest();
      if (boundary === "request") state.selectedRequest.value = request("new-request");
      if (boundary === "project") state.selectedProjectId.value = "project-2";
      if (boundary === "account") props.currentUser = { id: "other-owner" };
      if (boundary === "unmount") dispose();
      delayed.resolve({ ...request(), title: "Stale refreshed detail" });
      await refreshing;
      assert.notEqual(state.selectedRequest.value?.title, "Stale refreshed detail");
      assert.deepEqual(state.requests.value, []);
      assert.equal(state.errorMessage.value, "");
    });
  }

  it("opens stored evidence only after its authorized URL resolves for the current record", async () => {
    const url = deferred<string>();
    const { state, openedWindows } = mountWorkspace({}, true, false, {
      getAssetDownloadUrl: (assetId: string) => { assert.equal(assetId, "asset-1"); return url.promise; },
    });
    state.selectedRequest.value!.runs = [run()];
    const opening = state.openStoredEvidence("asset-1");
    assert.deepEqual(openedWindows, []);
    url.resolve("https://files.example.test/signed-read");
    await opening;
    assert.deepEqual(openedWindows, [["https://files.example.test/signed-read", "_blank", "noopener,noreferrer"]]);
  });

  for (const boundary of ["request", "project", "account", "run", "unmount"] as const) {
    it(`does not open a delayed evidence URL across the ${boundary} boundary`, async () => {
      const url = deferred<string>();
      const { state, props, openedWindows, dispose } = mountWorkspace({}, true, false, { getAssetDownloadUrl: () => url.promise });
      state.selectedRequest.value!.runs = [run()];
      const opening = state.openStoredEvidence("asset-1");
      if (boundary === "request") state.selectedRequest.value = request("new-request");
      if (boundary === "project") state.selectedProjectId.value = "project-2";
      if (boundary === "account") props.currentUser = { id: "other-owner" };
      if (boundary === "run") state.selectedRequest.value!.runs = [run("new-run")];
      if (boundary === "unmount") dispose();
      url.resolve("https://files.example.test/old-signed-read");
      await opening;
      assert.deepEqual(openedWindows, []);
      assert.equal(state.errorMessage.value, "");
    });
  }

  it("does not show an old evidence lookup error after the current run changed", async () => {
    const url = deferred<string>();
    const { state, openedWindows } = mountWorkspace({}, true, false, { getAssetDownloadUrl: () => url.promise });
    state.selectedRequest.value!.runs = [run()];
    const opening = state.openStoredEvidence("asset-1");
    state.selectedRequest.value!.runs = [run("new-run")];
    url.reject(new Error("Old run evidence unavailable"));
    await opening;
    assert.deepEqual(openedWindows, []);
    assert.equal(state.errorMessage.value, "");
  });
});

function mountWorkspace(api: Record<string, unknown>, signedIn = false, liveWatchers = false, assetsApi: Record<string, unknown> = {}) {
  const scheduledPolls: Array<() => void> = [];
  const openedWindows: unknown[][] = [];
  let dispose = () => {};
  const modules: Record<string, unknown> = {
    // Most tests isolate async handlers. Mount/load tests opt into real Vue
    // watchers so initial selection and scheduling are covered too.
    vue: { ...vue, watch: liveWatchers ? vue.watch : () => () => {}, onBeforeUnmount: (callback: () => void) => { dispose = callback; } },
    "../../i18n/useI18n": i18n,
    "../assets/assetsApi": assetsApi,
    "./components/QaConnectionModal.vue": {},
    "./components/QaPlaywrightRunModal.vue": {},
    "./components/QaRequestFormModal.vue": {},
    "./components/QaEvidenceCard.vue": {},
    "./harnessPresentation": harness,
    "./workspacePresentation": presentation,
    "./qaApi": api,
  };
  const module = { exports: {} as { default?: { setup: (props: unknown, context: unknown) => WorkspaceState } } };
  new Function("require", "exports", "window", script)((id: string) => {
    assert.ok(id in modules, `Unexpected Workspace dependency: ${id}`);
    return modules[id];
  }, module.exports, {
    setTimeout: (callback: () => void) => scheduledPolls.push(callback),
    clearTimeout: () => {},
    open: (...args: unknown[]) => { openedWindows.push(args); return {}; },
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
  return { state, scheduledPolls, openedWindows, props, dispose: () => { dispose(); scope.stop(); } };
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

function run(id = "run-1"): QaRun {
  return {
    id, requestId: "request-1", artifactId: "artifact-1", status: "RESULTS_SUBMITTED", outcome: "PASS", version: 1,
    sourceLabel: "Runner", externalRunRef: null, commitSha: null, startedAt: "2026-09-08T00:00:00Z", submittedAt: "2026-09-08T00:00:00Z",
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", results: [], evidence: [],
  };
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
