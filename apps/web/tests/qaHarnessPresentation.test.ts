import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  describeQaRecipeStep,
  isQaHarnessPollingActive,
  qaExecutionStatusPresentation,
  qaOperationGroups,
  qaOperationPresentation,
  qaRecipeCanRunOnProfile,
  qaRecipeCoverage,
  qaRecipeReviewState,
  qaRunnerProfileManifest,
} from "../src/features/qa/harnessPresentation.ts";
import type { QaExecutionRecipe, QaOperationReceipt, QaRunnerProfile } from "../src/features/qa/types.ts";
import { setLocale } from "../src/i18n/useI18n.ts";

describe("QA harness presentation", () => {
  beforeEach(() => setLocale("en"));

  it("moves older terminal reviews into history without changing or discarding their receipts", () => {
    const latest = operation({ operationId: "new", kind: "EXECUTION_RECIPE_REVIEW", recipeId: "recipe-1", status: "SUCCEEDED" });
    const failed = operation({ operationId: "old", kind: "EXECUTION_RECIPE_REVIEW", recipeId: "recipe-1", errorCode: "AI_PROVIDER_REQUEST_REJECTED" });
    const receipts = Object.freeze([Object.freeze(latest), Object.freeze(failed)]);
    assert.deepEqual(qaOperationGroups(receipts), { current: [latest], earlier: [failed] });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.errorCode, "AI_PROVIDER_REQUEST_REJECTED");
    const presentation = qaOperationPresentation(failed, true);
    assert.equal(presentation.tone, "neutral");
    assert.match(presentation.message, /Earlier attempt failed \(AI_PROVIDER_REQUEST_REJECTED\)/);
    assert.doesNotMatch(presentation.message, /Retry review|recovered|succeeded/i);
  });

  it("shows pending retries and latest failures, without claiming the earlier failure was recovered", () => {
    const old = operation({ operationId: "old", artifactId: "artifact-1" });
    for (const status of ["PENDING", "PROCESSING", "FAILED"] as const) {
      const latest = { ...old, operationId: "new", status };
      assert.deepEqual(qaOperationGroups([latest, old]), { current: [latest], earlier: [old] });
    }
  });

  it("never hides in-flight work even when a newer terminal operation exists", () => {
    const latest = operation({ operationId: "new", artifactId: "artifact-1", status: "SUCCEEDED" });
    for (const status of ["PENDING", "PROCESSING"] as const) {
      const active = { ...latest, operationId: "active", status };
      assert.deepEqual(qaOperationGroups([latest, active]), { current: [latest, active], earlier: [] });
    }
  });

  it("keeps unrelated requests, artifacts, Recipes, and operation kinds separate", () => {
    const latest = operation({ kind: "EXECUTION_RECIPE_REVIEW", artifactId: "artifact-1", recipeId: "recipe-1", status: "SUCCEEDED" });
    for (const scope of [
      { requestId: "another-request" }, { artifactId: "another-artifact" },
      { recipeId: "another-recipe" }, { kind: "CHECKLIST_REVIEW" as const },
    ]) {
      const failure = { ...latest, ...scope, operationId: "unrelated", status: "FAILED" as const };
      assert.deepEqual(qaOperationGroups([latest, failure]), { current: [latest, failure], earlier: [] });
    }
  });

  it("does not infer replacement of reviews or Recipe generation without target identity", () => {
    for (const kind of ["CHECKLIST_REVIEW", "EXECUTION_RECIPE_REVIEW", "EXECUTION_RECIPE_GENERATION"] as const) {
      const first = operation({ kind, operationId: "new", status: "SUCCEEDED" });
      const second = operation({ kind, operationId: "old" });
      assert.deepEqual(qaOperationGroups([first, second]), { current: [first, second], earlier: [] });
    }
  });

  it("groups generation by its input target, not by a Recipe id assigned only after success", () => {
    const old = operation({ operationId: "old", artifactId: "artifact-1", recipeId: null });
    const latest = { ...old, operationId: "new", recipeId: "new-recipe", status: "SUCCEEDED" as const };
    assert.deepEqual(qaOperationGroups([latest, old]), { current: [latest], earlier: [old] });
    // Checklist generation has no input artifact; success may create one.
    const checklist = operation({ kind: "CHECKLIST_GENERATION", operationId: "checklist-old" });
    const generated = { ...checklist, operationId: "checklist-new", artifactId: "new-checklist", status: "SUCCEEDED" as const };
    assert.deepEqual(qaOperationGroups([generated, checklist]), { current: [generated], earlier: [checklist] });
  });

  it("uses API receipt order rather than completion/retry time and does not truncate current work", () => {
    const first = operation({ operationId: "new", artifactId: "artifact-1", status: "SUCCEEDED", completedAt: "2026-09-09T10:00:00Z" });
    const second = { ...first, operationId: "old", status: "FAILED" as const, completedAt: "2026-09-09T11:00:00Z", availableAt: "2026-09-10T10:00:00Z" };
    assert.deepEqual(qaOperationGroups([first, second]), { current: [first], earlier: [second] });
    const many = Array.from({ length: 5 }, (_, index) => operation({ operationId: String(index), artifactId: `artifact-${index}` }));
    assert.deepEqual(qaOperationGroups(many), { current: many, earlier: [] });
    assert.deepEqual(qaOperationGroups([]), { current: [], earlier: [] });
  });

  it("localizes earlier-attempt explanations and retains the stable error code", () => {
    for (const locale of ["ar", "de"] as const) {
      setLocale(locale);
      const text = qaOperationPresentation(operation({ errorCode: "AI_PROVIDER_REQUEST_REJECTED" }), true).message;
      assert.ok(text.includes("AI_PROVIDER_REQUEST_REJECTED"));
      assert.ok(!text.startsWith("Earlier attempt"));
    }
  });

  it("explains invalid generated Recipes and the available recovery action", () => {
    assert.deepEqual(qaOperationPresentation(operation({ errorCode: "QA_RECIPE_OUTPUT_INVALID" })), {
      message: "The AI returned an incompatible Recipe. This operation did not start an execution. Open Run with Playwright and generate a new Recipe.",
      tone: "danger",
    });
  });

  it("explains unusable Recipe reviews with the explicit review retry action", () => {
    assert.deepEqual(qaOperationPresentation(operation({
      errorCode: "QA_RECIPE_REVIEW_INVALID",
      kind: "EXECUTION_RECIPE_REVIEW",
    })), {
      message: "The AI returned an unusable Recipe review. This operation did not start an execution. Open Run with Playwright, select this Recipe, and choose Retry review.",
      tone: "danger",
    });
  });

  it("retains fallback messages for unknown and absent failure codes", () => {
    assert.deepEqual(qaOperationPresentation(operation({ errorCode: "QA_PROCESSING_FAILED" })), {
      message: "Oddpath could not finish this operation (QA_PROCESSING_FAILED).",
      tone: "danger",
    });
    for (const errorCode of [undefined, null, ""]) {
      assert.deepEqual(qaOperationPresentation(operation({ errorCode })), {
        message: "Oddpath could not finish this operation.",
        tone: "danger",
      });
    }
  });

  it("does not show failure messages for nonfailed operations even with a stale failure code", () => {
    for (const errorCode of ["QA_RECIPE_OUTPUT_INVALID", "QA_RECIPE_REVIEW_INVALID", "QA_PROCESSING_FAILED"]) {
      assert.deepEqual(qaOperationPresentation(operation({ errorCode, status: "PENDING" })), {
        message: "Waiting for Oddpath processing.",
        tone: "active",
      });
      assert.deepEqual(qaOperationPresentation(operation({ errorCode, status: "PROCESSING" })), {
        message: "Oddpath is processing this record.",
        tone: "active",
      });
      assert.deepEqual(qaOperationPresentation(operation({ errorCode, status: "SUCCEEDED" })), {
        message: "Processing complete.",
        tone: "success",
      });
    }
  });

  it("reads new Recipe failure messages from the active locale catalog", () => {
    setLocale("de");
    assert.match(qaOperationPresentation(operation({ errorCode: "QA_RECIPE_OUTPUT_INVALID" })).message,
      /^Die KI hat ein inkompatibles Recipe/);
    setLocale("ar");
    assert.match(qaOperationPresentation(operation({ errorCode: "QA_RECIPE_REVIEW_INVALID" })).message,
      /^أعاد الذكاء الاصطناعي/);
  });

  it("describes strict Recipe v1 locators and profile values", () => {
    assert.equal(describeQaRecipeStep({
      action: "fill",
      locator: { by: "label", value: "Email" },
      ref: "fill-email",
      value: { key: "account.email", source: "profile" },
    }), "Fill label “Email” with profile value “account.email”");

    assert.equal(describeQaRecipeStep({
      action: "expect",
      expectation: {
        kind: "textContains",
        expected: "Order confirmed",
        locator: { by: "role", role: "heading", name: "Confirmation" },
      },
      ref: "expect-confirmation",
    }), "Verify role heading named “Confirmation” text contains “Order confirmed”");
  });

  it("exposes only the public Runner profile manifest", () => {
    const manifest = qaRunnerProfileManifest(profile());

    assert.deepEqual(manifest.valueReferences, [{ key: "account.email", secret: true }]);
    assert.equal(manifest.manifestHash, "b".repeat(64));
    assert.equal("baseUrl" in manifest, false);
  });

  it("requires an online Runner with the same immutable profile manifest", () => {
    const recipe = executionRecipe();

    assert.equal(qaRecipeCanRunOnProfile(recipe, profile()), true);
    assert.equal(qaRecipeCanRunOnProfile(recipe, profile({ manifestHash: "c".repeat(64) })), false);
    assert.equal(qaRecipeCanRunOnProfile(recipe, profile({ status: "OFFLINE" })), false);
  });

  it("summarizes Recipe coverage from the canonical bundle", () => {
    assert.equal(qaRecipeCoverage(executionRecipe()), "1 checklist item · 2 actions");
  });

  it("only retries the latest failed review and never treats missing or pending reviews as approved", () => {
    assert.equal(qaRecipeReviewState(null).canRetry, false);
    const recipe = executionRecipe();
    assert.equal(qaRecipeReviewState(recipe).isReviewed, false);
    for (const status of ["PENDING", "PASSED", "SUGGESTIONS", "FAILED"] as const) {
      recipe.assessments = [{
        id: "latest-assessment", status, summary: null, suggestions: [],
        createdAt: "2026-09-08T00:00:00.000Z", completedAt: null,
      }, {
        id: "old-failure", status: "FAILED", summary: null, suggestions: [],
        createdAt: "2026-09-07T00:00:00.000Z", completedAt: null,
      }];
      assert.equal(qaRecipeReviewState(recipe).canRetry, status === "FAILED");
      assert.equal(qaRecipeReviewState(recipe).isReviewed, status === "PASSED" || status === "SUGGESTIONS");
      assert.equal(qaRecipeReviewState(recipe, [], true).canRetry, false);
      assert.equal(qaRecipeReviewState(recipe, [], true).isReviewed, false);
    }
  });

  it("keeps a retry pending while its receipt is active even before the new assessment refreshes", () => {
    const recipe = executionRecipe();
    recipe.assessments = [{
      id: "failed-assessment", status: "FAILED", summary: null, suggestions: [],
      createdAt: "2026-09-08T00:00:00.000Z", completedAt: null,
    }];
    for (const status of ["PENDING", "PROCESSING"] as const) {
      const receipt = operation({ kind: "EXECUTION_RECIPE_REVIEW", recipeId: recipe.id, status });
      assert.equal(qaRecipeReviewState(recipe, [receipt]).isPending, true);
      assert.equal(qaRecipeReviewState(recipe, [receipt]).canRetry, false);
      assert.equal(qaRecipeReviewState(recipe, [receipt]).isReviewed, false);
      assert.equal(qaRecipeReviewState(recipe, [{ ...receipt, recipeId: "another-recipe" }]).canRetry, true);
    }
  });

  it("polls only while asynchronous processing or execution is active", () => {
    assert.equal(isQaHarnessPollingActive([{
      kind: "EXECUTION_RECIPE_REVIEW",
      operationId: "operation-1",
      requestId: "request-1",
      status: "PROCESSING",
    }]), true);
    assert.equal(isQaHarnessPollingActive([], {
      completedItems: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
      failureCode: null,
      failureMessage: null,
      id: "job-1",
      profileKey: "staging",
      recipeId: "recipe-1",
      runId: "run-1",
      runnerRegistrationId: "runner-1",
      status: "RUNNING",
      totalItems: 2,
      updatedAt: "2026-08-30T00:00:00.000Z",
    }), true);
    assert.equal(isQaHarnessPollingActive([], null), false);
  });

  it("keeps actionable Runner failure details", () => {
    const presentation = qaExecutionStatusPresentation({
      completedItems: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
      failureCode: "NAVIGATION_FAILED",
      failureMessage: "Checkout did not load.",
      id: "job-1",
      profileKey: "staging",
      recipeId: "recipe-1",
      runId: "run-1",
      runnerRegistrationId: "runner-1",
      status: "FAILED",
      totalItems: 2,
      updatedAt: "2026-08-30T00:00:00.000Z",
    });

    assert.equal(presentation?.label, "Execution failed");
    assert.equal(presentation?.message, "Checkout did not load.");
  });
});

function operation(overrides: Partial<QaOperationReceipt> = {}): QaOperationReceipt {
  return {
    kind: "EXECUTION_RECIPE_GENERATION",
    operationId: "operation-1",
    requestId: "request-1",
    status: "FAILED",
    ...overrides,
  };
}

function profile(overrides: Partial<QaRunnerProfile> = {}): QaRunnerProfile {
  return {
    environmentKind: "STAGING",
    evidenceKinds: ["TEXT", "SCREENSHOT"],
    id: "runner-1:staging",
    key: "staging",
    label: "Staging",
    lastSeenAt: "2026-08-30T00:00:00.000Z",
    manifestHash: "b".repeat(64),
    runnerInstanceId: "runner-instance",
    runnerName: "Laptop Runner",
    runnerRegistrationId: "runner-1",
    runnerVersion: "0.1.0",
    status: "ONLINE",
    supportedRecipeVersions: [1],
    valueRefs: [{ name: "account.email", secret: true }],
    ...overrides,
  };
}

function executionRecipe(): QaExecutionRecipe {
  const items = [{
    checklistItemId: "item-1",
    steps: [
      { action: "navigate" as const, path: "/checkout", ref: "open", waitUntil: "domcontentloaded" as const },
      {
        action: "expect" as const,
        expectation: { kind: "visible" as const, locator: { by: "role" as const, role: "heading", name: "Checkout" } },
        ref: "expect-checkout",
      },
    ],
  }];
  return {
    artifactId: "artifact-1",
    assessments: [],
    bundle: { engine: "playwright", items, schemaVersion: 1 },
    createdAt: "2026-08-30T00:00:00.000Z",
    executorKey: "playwright",
    id: "recipe-1",
    items: items.map((item) => ({ ...item, ordinal: 0 })),
    origin: "ODDPATH_GENERATED",
    profileManifest: qaRunnerProfileManifest(profile()),
    profileManifestHash: "b".repeat(64),
    recipeHash: "a".repeat(64),
    requestId: "request-1",
    revision: 1,
    schemaVersion: 1,
    supersedesRecipeId: null,
    title: "Checkout Recipe",
  };
}
