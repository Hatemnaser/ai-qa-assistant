import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import * as approval from "../src/features/qa/useQaRunApproval.ts";
import type { QaExecutionRecipe, QaRecipeStep, QaRunnerProfile } from "../src/features/qa/types.ts";
import * as presentation from "../src/features/qa/runApprovalPresentation.ts";
import * as onboarding from "../src/features/qa/runnerOnboarding.ts";
import * as i18n from "../src/i18n/useI18n.ts";

const source = await readFile(new URL("../src/features/qa/components/QaRunApprovalPanel.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const script = transpileModule(compileScript(descriptor, { id: "qa-inline-approval-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const scopes: vue.EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  i18n.setLocale("en");
});

describe("shared inline exact-run approval", () => {
  it("temporarily blocks a conversational POST without consuming unchanged consent", () => {
    const { state, emitted, props } = mountPanel();
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    props.isDiscussing = true;
    state.start();
    assert.deepEqual(emitted, []);
    assert.equal(state.recipeApproved.value, true);
    assert.equal(state.productionConfirmed.value, true);
    props.isDiscussing = false;
    assert.equal(state.canStart.value, true);
    props.requestVersion = 2;
    assert.equal(state.recipeApproved.value, false, 'Actual request revisions still invalidate consent');
  });

  it("requires explicit review plus separate production confirmation and consumes approval on start", async () => {
    const { state, emitted, props } = mountPanel();
    state.start();
    assert.deepEqual(emitted, []);
    state.recipeApproved.value = true;
    state.start();
    assert.equal(state.startBlockReason.value, "projects.qa.approval.productionRequired");
    state.productionConfirmed.value = true;
    state.start();
    state.start();
    state.generate();
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], ["start", { confirmProduction: true, profile: props.profiles[0], recipe: props.recipes[0] }]);
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    await vue.nextTick();
    state.start();
    assert.equal(emitted.length, 1, "a released click latch must not restore consumed approval");
  });

  it("resets approval synchronously for every record identity, version, selected input, review or load boundary", () => {
    const cases: Array<[string, (props: approval.QaRunApprovalProps) => void]> = [
      ["owner identity", p => { p.identityKey = "other-owner/project/session/request"; }],
      ["request version", p => { p.requestVersion = 2; }],
      ["request identity", p => { p.artifact.requestId = "other-request"; }],
      ["artifact identity", p => { p.artifact.id = "other-artifact"; }],
      ["profile manifest", p => { p.profiles[0]!.manifestHash = "c".repeat(64); }],
      ["profile status", p => { p.profiles[0]!.status = "OFFLINE"; }],
      ["profile environment", p => { p.profiles[0]!.environmentKind = "LOCAL"; }],
      ["runner identity", p => { p.profiles[0]!.runnerRegistrationId = "other-runner"; }],
      ["profile key", p => { p.profiles[0]!.key = "other-key"; }],
      ["supported protocol", p => { p.profiles[0]!.supportedRecipeVersions = [2]; }],
      ["Recipe hash", p => { p.recipes[0]!.recipeHash = "c".repeat(64); }],
      ["Recipe manifest", p => { p.recipes[0]!.profileManifestHash = "c".repeat(64); }],
      ["assessment identity", p => { p.recipes[0]!.assessments[0]!.id = "new-review"; }],
      ["assessment status", p => { p.recipes[0]!.assessments[0]!.status = "SUGGESTIONS"; }],
      ["review pending", p => { p.isRetryingReview = true; }],
      ["profile refresh", p => { p.isLoadingProfiles = true; }],
      ["profile error", p => { p.profileLoadError = "Read failed"; }],
      ["record error", p => { p.readError = "Record unavailable"; }],
      ["disabled", p => { p.disabled = true; }],
      ["closed", p => { p.isOpen = false; }],
      ["saving", p => { p.isSaving = true; }],
      ["generating", p => { p.isGenerating = true; }],
    ];
    for (const [name, mutate] of cases) {
      const { props, state, emitted } = mountPanel();
      state.recipeApproved.value = true;
      state.productionConfirmed.value = true;
      assert.equal(state.canStart.value, true, name);
      mutate(props);
      assert.equal(state.recipeApproved.value, false, `${name}: no nextTick gap`);
      assert.equal(state.productionConfirmed.value, false, name);
      state.start();
      assert.deepEqual(emitted, [], name);
    }
  });

  it("does not replace a selected compatible reviewed Recipe with a newer revision automatically", () => {
    const { props, state } = mountPanel();
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    props.recipes.unshift({ ...recipe("newer"), revision: 2, assessments: [] });
    assert.equal(state.selectedRecipeId.value, "recipe-1");
    assert.equal(state.canStart.value, true);
    state.selectedRecipeId.value = "newer";
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.canStart.value, false);
  });

  it("keeps Recipe selection request-scoped even if stale data shares an artifact id", () => {
    const { state, emitted } = mountPanel({ recipes: [{ ...recipe(), requestId: "other-request" }] });
    assert.equal(state.selectedRecipe.value, null);
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    state.start();
    assert.deepEqual(emitted, []);
  });

  it("resets explicit approval when selecting another compatible profile or Recipe", () => {
    const { state } = mountPanel({ profiles: [profile(), { ...profile(), id: "other-profile" }], recipes: [recipe(), recipe("other-recipe")] });
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    state.selectedProfileId.value = "other-profile";
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
    state.recipeApproved.value = true;
    state.productionConfirmed.value = true;
    state.selectedRecipeId.value = "other-recipe";
    assert.equal(state.recipeApproved.value, false);
    assert.equal(state.productionConfirmed.value, false);
  });

  it("latches generation until the parent updates and releases a declined action safely", async () => {
    const { state, emitted } = mountPanel();
    state.generate();
    state.generate();
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.[0], "generate");
    await vue.nextTick();
    state.generate();
    assert.equal(emitted.length, 2);
  });

  it("blocks all write actions after record errors, but keeps review recovery independent from Runner discovery", () => {
    for (const overrides of [{ readError: "Stale record" }, { disabled: true }, { isOpen: false }]) {
      const { state, emitted } = mountPanel({ ...overrides, recipes: [recipe("recipe-1", "FAILED")] });
      state.retryReview();
      state.generate();
      state.start();
      assert.deepEqual(emitted, []);
    }
    for (const overrides of [{ profiles: [] }, { isLoadingProfiles: true }, { profileLoadError: "Unavailable" }]) {
      const { state, emitted } = mountPanel({ ...overrides, recipes: [recipe("recipe-1", "FAILED")] });
      state.retryReview();
      state.retryReview();
      assert.deepEqual(emitted, [["retryReview", { recipeId: "recipe-1", assessmentId: "recipe-1-review" }]]);
    }
  });

  it("renders inline disclosure and explicit approval without automatic navigation actions or a dialog", () => {
    const template = descriptor.template!.content;
    assert.match(template, /<Teleport :to="detailsTarget \|\| 'body'" :disabled="!detailsTarget">/);
    assert.equal(template.includes('role="dialog"'), false);
    assert.match(template, /<details[^>]*class="qa-run-approval__details"/);
    assert.match(template, /@keydown\.esc\.stop\.prevent="detailsTarget && closeDetails\(\)"/);
    assert.equal((template.match(/:aria-describedby="statusId"/g) || []).length, 3);
    assert.match(template, /:id="statusId" role="status" aria-live="polite"/);
    assert.match(template, /v-model="recipeApproved" type="checkbox" :disabled="approvalDisabled"/);
    assert.match(template, /v-model="productionConfirmed" type="checkbox" :disabled="approvalDisabled"/);
    assert.match(template, /:disabled="!canStart"[^>]*@click="start"/);
    assert.ok(template.indexOf('v-else-if="profileLoadError"') < template.indexOf('v-else-if="profiles.length === 0"'));
    assert.match(template, /JSON\.stringify\(selectedRecipe.bundle, null, 2\)/);
    assert.match(template, /class="qa-run-approval__recovery"/);
    assert.match(template, /projects\.qa\.runSetup\.reconnectTitle/);
    assert.match(template, /projects\.qa\.runSetup\.steps/);
    assert.match(template, /@click="emit\('refresh'\)"/);
    assert.match(template, /@click="emit\('connect'\)"/);
    assert.match(template, /RUNNER_START_POWERSHELL/);
    const { emitted } = mountPanel();
    assert.deepEqual(emitted, [], "mounting or choosing defaults must not generate or start a run");
  });

  it("localizes immutable step descriptions without resolving local secret references", () => {
    const steps: QaRecipeStep[] = [
      { ref: "open", action: "navigate", path: "/#/login", waitUntil: "load" },
      { ref: "fill", action: "fill", locator: { by: "label", value: "Password" }, value: { source: "profile", key: "TEST_PASSWORD" } },
      { ref: "verify", action: "expect", expectation: { kind: "visible", locator: { by: "role", role: "heading", name: "Welcome" } } },
    ];
    const outputs = new Set<string>();
    for (const locale of ["en", "ar", "de"] as const) {
      i18n.setLocale(locale);
      const output = steps.map(step => presentation.describeApprovalStep(step, i18n.t)).join("\n");
      assert.equal(output.includes("projects.qa."), false);
      assert.ok(output.includes("TEST_PASSWORD"));
      assert.ok(output.includes("/#/login"));
      outputs.add(output);
    }
    assert.equal(outputs.size, 3);
  });
});

function mountPanel(overrides: Partial<approval.QaRunApprovalProps> = {}) {
  const props = vue.reactive<approval.QaRunApprovalProps>({
    artifact: { id: "artifact-1", requestId: "request-1", revision: 1, origin: "ODDPATH_GENERATED", title: "Checklist", lockedAt: null, createdAt: "2026-09-08T00:00:00Z", assessments: [], items: [] },
    identityKey: "owner/project/session/request-1", requestVersion: 1,
    isGenerating: false, isLoadingProfiles: false, isRetryingReview: false, isSaving: false,
    operations: [], profiles: [profile()], recipes: [recipe()], ...overrides,
  });
  const emitted: unknown[][] = [];
  const modules: Record<string, unknown> = {
    vue: { ...vue, useId: () => "test-inline-approval" },
    "../../../i18n/useI18n": i18n,
    "../useQaRunApproval": approval,
    "../runApprovalPresentation": presentation,
    "../runnerOnboarding": onboarding,
  };
  type State = ReturnType<typeof approval.useQaRunApproval>;
  const module = { exports: {} as { default?: { setup: (props: approval.QaRunApprovalProps, context: unknown) => State } } };
  new Function("require", "exports", script)((id: string) => {
    assert.ok(id in modules, `Unexpected approval dependency: ${id}`);
    return modules[id];
  }, module.exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const state = scope.run(() => module.exports.default!.setup(props, { expose: () => {}, emit: (...args: unknown[]) => emitted.push(args) }))!;
  return { state, props, emitted };
}

function profile(): QaRunnerProfile {
  return {
    id: "profile-1", key: "production", label: "Production", runnerRegistrationId: "runner-1",
    runnerName: "Runner", runnerInstanceId: "runner-instance", runnerVersion: "0.1.0",
    environmentKind: "PRODUCTION", status: "ONLINE", supportedRecipeVersions: [1], valueRefs: [],
    evidenceKinds: ["TEXT"], manifestHash: "b".repeat(64), lastSeenAt: null,
  };
}

function recipe(id = "recipe-1", status: QaExecutionRecipe["assessments"][number]["status"] = "PASSED"): QaExecutionRecipe {
  return {
    id, artifactId: "artifact-1", requestId: "request-1", revision: 1, origin: "ODDPATH_GENERATED",
    title: "Recipe", schemaVersion: 1, executorKey: "playwright", recipeHash: "a".repeat(64),
    bundle: { schemaVersion: 1, engine: "playwright", items: [] }, profileManifest: null,
    profileManifestHash: "b".repeat(64), supersedesRecipeId: null, items: [], createdAt: "2026-09-08T00:00:00Z",
    assessments: [{ id: `${id}-review`, status, summary: null, suggestions: [], createdAt: "2026-09-08T00:00:00Z", completedAt: null }],
  };
}
