import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import * as harness from "../src/features/qa/harnessPresentation.ts";
import * as approval from "../src/features/qa/useQaRunApproval.ts";
import type { QaArtifact, QaExecutionRecipe, QaOperationReceipt, QaRunnerProfile } from "../src/features/qa/types.ts";
import * as i18n from "../src/i18n/useI18n.ts";

interface ModalProps {
  artifact: QaArtifact;
  isGenerating: boolean;
  isLoadingProfiles: boolean;
  isOpen: boolean;
  isRetryingReview: boolean;
  isSaving: boolean;
  operations: QaOperationReceipt[];
  profileLoadError?: string;
  profiles: QaRunnerProfile[];
  recipes: QaExecutionRecipe[];
  identityKey?: string;
  requestVersion?: number;
  readError?: string;
  disabled?: boolean;
}

interface ModalState {
  canGenerate: vue.ComputedRef<boolean>;
  canRetryReview: vue.ComputedRef<boolean>;
  canStart: vue.ComputedRef<boolean>;
  startBlockReason: vue.ComputedRef<string | null>;
  recipeApproved: vue.Ref<boolean>;
  productionConfirmed: vue.Ref<boolean>;
  selectedRecipeId: vue.Ref<string>;
  recipeReview: vue.ComputedRef<ReturnType<typeof harness.qaRecipeReviewState>>;
  retryReview(): void;
  start(): void;
  generate(): void;
}

const source = await readFile(new URL("../src/features/qa/components/QaPlaywrightRunModal.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const script = transpileModule(compileScript(descriptor, { id: "qa-review-retry-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const scopes: vue.EffectScope[] = [];

afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

describe("Playwright Recipe review retry modal", () => {
  it("emits the selected Recipe and latest failed assessment only once before the parent updates", async () => {
    const { state, emitted } = mountModal();
    state.selectedRecipeId.value = "selected-recipe";
    await vue.nextTick();
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;

    state.retryReview();
    state.retryReview();
    state.start();

    assert.deepEqual(emitted, [["retryReview", {
      recipeId: "selected-recipe", assessmentId: "selected-recipe-failed-review",
    }]]);
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    assert.equal(state.recipeReview.value.isPending, true);
    assert.equal(state.canRetryReview.value, false);
    assert.equal(state.canStart.value, false);
  });

  it("offers retry without an online Runner but never allows an offline execution", () => {
    for (const profiles of [[], [profile("OFFLINE")]]) {
      const { state, emitted } = mountModal({ profiles });
      assert.equal(state.canRetryReview.value, true);
      state.retryReview();
      assert.equal(emitted.length, 1);
      assert.equal(state.canStart.value, false);
    }
  });

  it("does not retry missing, pending, passed, suggested, or busy reviews", () => {
    for (const status of [null, "PENDING", "PASSED", "SUGGESTIONS"] as const) {
      const candidate = recipe("recipe-1", status);
      if (status) candidate.assessments.push(recipe("old").assessments[0]!);
      const { state, emitted } = mountModal({ recipes: [candidate] });
      state.retryReview();
      assert.equal(state.canRetryReview.value, false);
      assert.deepEqual(emitted, []);
    }
    for (const busy of [{ isSaving: true }, { isGenerating: true }, { isRetryingReview: true }]) {
      const { state, emitted } = mountModal(busy);
      state.retryReview();
      assert.deepEqual(emitted, []);
    }
  });

  it("blocks approval through enqueue, receipt polling and PENDING assessment, then requires fresh approval", async () => {
    const { state, props, emitted } = mountModal();
    state.retryReview();
    props.isRetryingReview = true;
    await vue.nextTick();
    props.operations = [{ kind: "EXECUTION_RECIPE_REVIEW", operationId: "retry-op", recipeId: "recipe-1", requestId: "request-1", status: "PENDING" }];
    props.isRetryingReview = false;
    await vue.nextTick();
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    state.start();
    state.retryReview();
    assert.equal(state.canStart.value, false);
    assert.equal(emitted.length, 1);

    props.recipes = [recipe("recipe-1", "PENDING")];
    props.operations[0]!.status = "PROCESSING";
    await vue.nextTick();
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    assert.equal(state.canRetryReview.value, false);
    assert.equal(state.canStart.value, false);

    props.recipes = [recipe("recipe-1", "PASSED")];
    props.operations[0]!.status = "SUCCEEDED";
    await vue.nextTick();
    assert.equal(state.recipeReview.value.isReviewed, true);
    assert.equal(state.canStart.value, false);
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    assert.equal(state.canStart.value, true);
    state.start();
    assert.equal(state.canStart.value, false);
    assert.equal(state.recipeApproved.value, false);
    assert.equal(emitted[1]?.[0], "start");
  });

  it("releases the local click guard if enqueue fails so the owner can try again", async () => {
    const { state, props, emitted } = mountModal();
    state.retryReview();
    props.isRetryingReview = true;
    await vue.nextTick();
    props.isRetryingReview = false;
    await vue.nextTick();
    assert.equal(state.canRetryReview.value, true);
    state.retryReview();
    assert.equal(emitted.length, 2);
  });

  it("releases the local click guard when the parent declines a stale action without a busy transition", async () => {
    const { state, emitted } = mountModal();
    state.retryReview();
    state.retryReview();
    assert.equal(emitted.length, 1);
    await vue.nextTick();
    assert.equal(state.canRetryReview.value, true);
    state.retryReview();
    assert.equal(emitted.length, 2);
  });

  it("wires the failure-only action and disables both approval controls while review is unavailable", () => {
    assert.match(descriptor.template!.content, /v-else-if="latestRecipeAssessment\?\.status === 'FAILED'"/);
    assert.match(descriptor.template!.content, /:disabled="!canRetryReview" @click="retryReview"/);
    for (const field of ["recipeApproved", "productionConfirmed"]) {
      assert.ok(descriptor.template!.content.includes(`v-model="${field}" type="checkbox" :disabled="approvalDisabled"`));
    }
  });

  it("explains the first blocking action without weakening the execution gates", () => {
    const reviewed = recipe("recipe-1", "PASSED");
    const cases: { overrides: Partial<ModalProps>; reason: string }[] = [
      { overrides: { isSaving: true }, reason: "queueing" },
      { overrides: { isGenerating: true }, reason: "generating" },
      { overrides: { isRetryingReview: true }, reason: "reviewPending" },
      { overrides: { recipes: [recipe("recipe-1", "PENDING")] }, reason: "reviewPending" },
      { overrides: { recipes: [recipe("recipe-1", "FAILED")], profiles: [profile("OFFLINE")] }, reason: "reviewFailed" },
      { overrides: { recipes: [recipe("recipe-1", null)] }, reason: "reviewMissing" },
      { overrides: { profiles: [], isLoadingProfiles: true }, reason: "loadingProfiles" },
      { overrides: { isLoadingProfiles: true }, reason: "loadingProfiles" },
      { overrides: { profiles: [] }, reason: "profileMissing" },
      { overrides: { profiles: [profile("OFFLINE")] }, reason: "profileOffline" },
      { overrides: { profiles: [profile("INCOMPATIBLE")] }, reason: "profileIncompatible" },
      { overrides: { recipes: [] }, reason: "recipeMissing" },
      { overrides: { profiles: [{ ...profile(), manifestHash: "c".repeat(64) }] }, reason: "profileMismatch" },
      { overrides: { profiles: [{ ...profile(), manifestHash: null }] }, reason: "profileMismatch" },
      { overrides: { profiles: [{ ...profile(), supportedRecipeVersions: [2] }] }, reason: "profileMismatch" },
    ];

    for (const { overrides, reason } of cases) {
      const { state, emitted } = mountModal({ recipes: [reviewed], ...overrides });
      state.recipeApproved.value = true;
      state.productionConfirmed.value = true;
      assert.equal(state.startBlockReason.value, `projects.qa.approval.${reason}`);
      assert.equal(state.canStart.value, false, reason);
      state.start();
      assert.deepEqual(emitted, [], reason);
    }
  });

  it("prioritizes active review over an earlier failure and an offline Runner", () => {
    const { state } = mountModal({
      profiles: [profile("OFFLINE")],
      operations: [{ kind: "EXECUTION_RECIPE_REVIEW", operationId: "retry-op", recipeId: "recipe-1", requestId: "request-1", status: "PROCESSING" }],
    });
    assert.equal(state.startBlockReason.value, "projects.qa.approval.reviewPending");
    assert.equal(state.canStart.value, false);
  });

  it("blocks stale online profiles on discovery failure without presenting them as missing", () => {
    for (const profiles of [[], [profile()]]) {
      const { state, emitted } = mountModal({
        recipes: [recipe("recipe-1", "PASSED")],
        profiles,
        profileLoadError: "Discovery unavailable",
      });
      state.recipeApproved.value = true;
      state.productionConfirmed.value = true;
      assert.equal(state.startBlockReason.value, "projects.integrations.errors.profiles");
      assert.equal(state.canGenerate.value, false);
      assert.equal(state.canStart.value, false);
      state.generate();
      state.start();
      assert.deepEqual(emitted, []);
    }
    const template = descriptor.template!.content;
    assert.match(template, /v-if="isLoadingProfiles"[^>]*role="status"/);
    assert.match(template, /v-else-if="profileLoadError"[^>]*role="alert"/);
    assert.ok(template.indexOf('v-else-if="profileLoadError"') < template.indexOf('v-else-if="profiles.length === 0"'));
    assert.match(template, /@click="emit\('refresh'\)">{{ t\('projects.integrations.refresh'\) }}/);
  });

  it("preserves review recovery while profile discovery is unavailable", () => {
    for (const unavailable of [{ isLoadingProfiles: true }, { profileLoadError: "Discovery unavailable" }]) {
      const { state, emitted } = mountModal(unavailable);
      assert.equal(state.canRetryReview.value, true);
      assert.equal(state.startBlockReason.value, "projects.qa.approval.reviewFailed");
      state.generate();
      state.start();
      assert.deepEqual(emitted, []);
      state.retryReview();
      assert.equal(emitted[0]?.[0], "retryReview");
    }
  });

  it("requires fresh explicit approval after profile rediscovery or a manifest change", async () => {
    const { state, props, emitted } = mountModal({ recipes: [recipe("recipe-1", "PASSED")] });
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    assert.equal(state.canStart.value, true);
    props.isLoadingProfiles = true;
    assert.equal(state.canStart.value, false);
    assert.equal(state.canGenerate.value, false);
    state.start();
    state.generate();
    await vue.nextTick();
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    props.isLoadingProfiles = false;
    await vue.nextTick();
    assert.equal(state.startBlockReason.value, "projects.qa.approval.reviewRequired");
    assert.deepEqual(emitted, []);

    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    props.profiles[0]!.manifestHash = "c".repeat(64);
    await vue.nextTick();
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    assert.equal(state.startBlockReason.value, "projects.qa.approval.profileMismatch");
  });

  it("requires both explicit confirmations for production and only review approval for local execution", () => {
    const { state, emitted } = mountModal({ recipes: [recipe("recipe-1", "PASSED")] });
    assert.equal(state.startBlockReason.value, "projects.qa.approval.reviewRequired");
    state.start();
    assert.deepEqual(emitted, []);
    state.recipeApproved.value = true;
    assert.equal(state.startBlockReason.value, "projects.qa.approval.productionRequired");
    state.start();
    assert.deepEqual(emitted, []);
    state.productionConfirmed.value = true;
    assert.equal(state.startBlockReason.value, null);
    assert.equal(state.canStart.value, true);
    state.start();
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.[0], "start");
    assert.equal((emitted[0]?.[1] as { confirmProduction: boolean }).confirmProduction, true);

    const local = mountModal({
      profiles: [{ ...profile(), environmentKind: "LOCAL" }],
      recipes: [recipe("recipe-1", "SUGGESTIONS")],
    });
    local.state.recipeApproved.value = true;
    assert.equal(local.state.productionConfirmed.value, false);
    assert.equal(local.state.startBlockReason.value, null);
    assert.equal(local.state.canStart.value, true);
  });

  it("updates offline guidance after reconnection without generating, reviewing, or queueing automatically", async () => {
    const { state, props, emitted } = mountModal({
      profiles: [{ ...profile("OFFLINE"), environmentKind: "LOCAL" }],
      recipes: [recipe("recipe-1", "PASSED")],
    });
    assert.equal(state.startBlockReason.value, "projects.qa.approval.profileOffline");
    props.profiles[0]!.status = "ONLINE";
    await vue.nextTick();
    assert.equal(state.startBlockReason.value, "projects.qa.approval.reviewRequired");
    assert.equal(state.canStart.value, false);
    assert.deepEqual(emitted, []);
    state.recipeApproved.value = true;
    assert.equal(state.canStart.value, true);

    // A reconnected Runner with different public configuration is still fenced.
    props.profiles[0]!.manifestHash = "c".repeat(64);
    await vue.nextTick();
    assert.equal(state.startBlockReason.value, "projects.qa.approval.profileMismatch");
    state.start();
    assert.deepEqual(emitted, []);
  });

  it("associates the single approval explanation with both checkboxes and the queue button", () => {
    const template = descriptor.template!.content;
    assert.equal((template.match(/id="qa-run-approval-status"/g) || []).length, 1);
    assert.match(template, /id="qa-run-approval-status" role="status" aria-live="polite"/);
    assert.equal((template.match(/aria-describedby="qa-run-approval-status"/g) || []).length, 3);
    assert.match(template, /t\(startBlockReason \|\| 'projects\.qa\.approval\.ready'\)/);
    assert.match(template, /v-if="selectedProfile\?\.status === 'OFFLINE'"[^>]*open/);
    for (const key of ["terminal", "config", "token", "refresh", "preserveRecipe"]) {
      assert.ok(template.includes(`projects.qa.runSetup.${key}`));
    }
    assert.match(template, /<code dir="ltr">npm run dev:runner<\/code>/);
    assert.equal(template.includes("$env:"), false);
  });
});

function mountModal(overrides: Partial<ModalProps> = {}) {
  const props = vue.reactive<ModalProps>({
    artifact: { id: "artifact-1", requestId: "request-1", revision: 1, origin: "ODDPATH_GENERATED", title: "Checklist", lockedAt: null, createdAt: "2026-09-08T00:00:00Z", assessments: [], items: [] },
    isGenerating: false, isLoadingProfiles: false, isOpen: true, isRetryingReview: false, isSaving: false,
    operations: [], profiles: [profile()], recipes: [recipe("recipe-1"), recipe("selected-recipe")],
    ...overrides,
  });
  const emitted: unknown[][] = [];
  const modules: Record<string, unknown> = {
    vue,
    "../../../i18n/useI18n": i18n,
    "../../../ui/useDialogAccessibility": { useDialogAccessibility: () => ({ dialogRef: vue.ref(null), onDialogKeydown: () => {} }) },
    "../harnessPresentation": harness,
    "../useQaRunApproval": approval,
  };
  const module = { exports: {} as { default?: { setup: (props: ModalProps, context: unknown) => ModalState } } };
  // Exercise the actual SFC setup with Vue reactivity; only DOM accessibility is stubbed.
  new Function("require", "exports", script)((id: string) => {
    assert.ok(id in modules, `Unexpected modal dependency: ${id}`);
    return modules[id];
  }, module.exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const state = scope.run(() => module.exports.default!.setup(props, {
    expose: () => {}, emit: (...args: unknown[]) => emitted.push(args),
  }))!;
  return { state, props, emitted };
}

function profile(status: QaRunnerProfile["status"] = "ONLINE"): QaRunnerProfile {
  return {
    id: "profile-1", key: "production", label: "Production", runnerRegistrationId: "runner-1",
    runnerName: "Runner", runnerInstanceId: "runner-instance", runnerVersion: "0.1.0",
    environmentKind: "PRODUCTION", status, supportedRecipeVersions: [1], valueRefs: [],
    evidenceKinds: ["TEXT"], manifestHash: "b".repeat(64), lastSeenAt: null,
  };
}

function recipe(id: string, status: QaExecutionRecipe["assessments"][number]["status"] | null = "FAILED"): QaExecutionRecipe {
  return {
    id, artifactId: "artifact-1", requestId: "request-1", revision: 1, origin: "ODDPATH_GENERATED",
    title: "Recipe", schemaVersion: 1, executorKey: "playwright", recipeHash: "a".repeat(64),
    bundle: { schemaVersion: 1, engine: "playwright", items: [] }, profileManifest: null,
    profileManifestHash: "b".repeat(64), supersedesRecipeId: null, items: [], createdAt: "2026-09-08T00:00:00Z",
    assessments: status ? [{ id: `${id}-${status === "FAILED" ? "failed-review" : status}`, status, summary: null, suggestions: [], createdAt: "2026-09-08T00:00:00Z", completedAt: null }] : [],
  };
}
