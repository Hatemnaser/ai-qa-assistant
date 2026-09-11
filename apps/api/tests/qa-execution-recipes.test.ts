import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ProfileManifestV1,
  RecipeBundleV1,
} from "@oddpath/qa-execution-contract";

import {
  selectExecutableEvidenceRequirements,
  validateExecutionEvidenceCompatibility,
} from "../src/modules/qa-requests/qa-execution-evidence.ts";
import { createQaExecutionRecipeIntelligence } from "../src/modules/qa-requests/qa-execution-recipe.intelligence.ts";
import {
  RECIPE_LOCATOR_EXAMPLES,
  RECIPE_OUTPUT_EXAMPLE,
  RECIPE_STEP_EXAMPLES,
  RECIPE_VALUE_EXAMPLES,
} from "../src/modules/qa-requests/qa-execution-recipe.prompt.ts";
import { QaRecipeOutputError } from "../src/modules/qa-requests/qa-recipe-output.ts";
import { AppError } from "../src/lib/errors.ts";
import {
  RECIPE_ASSESSMENT_EXAMPLES,
  RECIPE_ASSESSMENT_JSON_SCHEMA,
} from "../src/modules/qa-requests/qa-recipe-assessment.schema.ts";
import {
  resolveProfileManifest,
  validateExecutionRecipeCompatibility,
} from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import type { QaContextSnapshotInput } from "../src/modules/qa-requests/qa-requests.types.ts";
import type { AiOperationUsageService } from "../src/modules/usage/usage.service.ts";
import {
  FALLBACK_AI_MODEL,
  FALLBACK_AI_PROVIDER,
} from "../src/modules/ai/provider-registry.ts";
import {
  QA_EXECUTION_RECIPE_GENERATION_ACTION,
  QA_EXECUTION_RECIPE_REVIEW_ACTION,
} from "../src/modules/usage/usage.types.ts";

const SNAPSHOT: QaContextSnapshotInput = {
  degraded: false,
  payload: { request: { objective: "Verify checkout" } },
  payloadHash: "a".repeat(64),
  retrievalMode: "SHARED_PROJECT_RETRIEVER",
  sourceManifest: { documents: [] },
};

const PROFILE: ProfileManifestV1 = {
  environmentKind: "TEST",
  evidenceKinds: ["TEXT"],
  executorKey: "playwright",
  label: "Checkout test",
  profileKey: "checkout-test",
  recipeSchemaVersions: [1],
  schemaVersion: 1,
  valueReferences: [{ key: "checkout.email", secret: true }],
};

const BUNDLE: RecipeBundleV1 = {
  engine: "playwright",
  items: [{
    checklistItemId: "item-1",
    steps: [
      { action: "navigate", path: "/checkout", ref: "open_checkout", waitUntil: "domcontentloaded" },
      {
        action: "fill",
        locator: { by: "label", value: "Email" },
        ref: "fill_email",
        value: { key: "checkout.email", source: "profile" },
      },
      {
        action: "expect",
        expectation: {
          kind: "visible",
          locator: { by: "role", name: "Checkout", role: "heading" },
        },
        ref: "verify_checkout",
      },
    ],
  }],
  schemaVersion: 1,
};

const ARTIFACT = {
  id: "artifact-1",
  items: [{
    clientRef: "checkout",
    evidenceRequirements: [{
      description: "Observed checkout result",
      id: "requirement-1",
      kind: "TEXT" as const,
      required: true,
    }],
    expectedResult: "Checkout is visible.",
    id: "item-1",
    ordinal: 0,
    preconditions: [],
    steps: ["Open checkout"],
    title: "Checkout",
  }],
  revision: 1,
  title: "Checkout QA",
};

describe("Execution Recipe static validation", () => {
  it("accepts exact checklist coverage and declared profile value references", () => {
    assert.doesNotThrow(() => validateExecutionRecipeCompatibility(
      BUNDLE,
      ARTIFACT,
      resolveProfileManifest(PROFILE)
    ));
  });

  it("rejects incomplete checklist coverage and undeclared profile values", () => {
    assert.throws(
      () => validateExecutionRecipeCompatibility(
        { ...BUNDLE, items: [] } as RecipeBundleV1,
        ARTIFACT,
        resolveProfileManifest(PROFILE)
      ),
      hasCode("QA_RECIPE_COVERAGE_INVALID")
    );
    const undeclared = structuredClone(BUNDLE);
    const fill = undeclared.items[0]?.steps[1];
    if (fill?.action === "fill") fill.value = { key: "checkout.password", source: "profile" };
    assert.throws(
      () => validateExecutionRecipeCompatibility(
        undeclared,
        ARTIFACT,
        resolveProfileManifest(PROFILE)
      ),
      hasCode("QA_RECIPE_PROFILE_VALUE_UNDECLARED")
    );
  });

  it("rejects evidence projections that would fail the ExecutionTask contract", () => {
    assert.throws(
      () => validateExecutionEvidenceCompatibility([{
        evidenceRequirements: [{
          description: "Optional file",
          id: "file-1",
          kind: "FILE",
          required: false,
        }],
        title: "File only",
      }], ["TEXT", "SCREENSHOT"]),
      hasCode("QA_RECIPE_EVIDENCE_NOT_EXECUTABLE")
    );
    assert.throws(
      () => validateExecutionEvidenceCompatibility([{
        evidenceRequirements: [1, 2, 3].map((ordinal) => ({
          description: `Text ${ordinal}`,
          id: `text-${ordinal}`,
          kind: "TEXT",
          required: false,
        })),
        title: "Too many",
      }], ["TEXT"]),
      hasCode("QA_RECIPE_EVIDENCE_LIMIT_EXCEEDED")
    );
  });

  it("projects only evidence kinds the selected runner profile can capture", () => {
    const selected = selectExecutableEvidenceRequirements([
      { description: "Text", id: "text-1", kind: "TEXT", required: false },
      { description: "Screenshot", id: "shot-1", kind: "SCREENSHOT", required: false },
    ], ["TEXT"]);

    assert.deepEqual(selected.map(({ id }) => id), ["text-1"]);
    assert.doesNotThrow(() => validateExecutionEvidenceCompatibility([{
      evidenceRequirements: [
        { description: "Text", id: "text-1", kind: "TEXT", required: false },
        { description: "Screenshot", id: "shot-1", kind: "SCREENSHOT", required: false },
      ],
      title: "Mixed optional evidence",
    }], ["TEXT"]));
  });
});

describe("Execution Recipe provider contract", () => {
  it("uses the injected provider adapter and tracks generation without exposing secret values", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText(input) {
        calls.push(`provider:${input.provider}:${input.model}`);
        assert.equal(input.signal, controller.signal);
        assert.equal(input.responseMimeType, "application/json");
        for (const example of [RECIPE_OUTPUT_EXAMPLE, RECIPE_STEP_EXAMPLES, RECIPE_LOCATOR_EXAMPLES, RECIPE_VALUE_EXAMPLES]) {
          assert.ok(input.prompt.includes(JSON.stringify(example)));
        }
        assert.match(input.prompt, /artifact\.items\[\]\.id, never clientRef/);
        assert.match(input.prompt, /including any intentionally failing assertion/);
        assert.match(input.prompt, /Only use profile keys declared in profileManifest\.valueReferences/);
        assert.match(input.prompt, /checkout\.email/);
        assert.doesNotMatch(input.prompt, /super-secret-value/);
        return {
          model: "mock-recipe-model",
          provider: "mock-provider",
          text: JSON.stringify({ bundle: BUNDLE, title: "Checkout recipe" }),
          usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        };
      },
      model: FALLBACK_AI_MODEL,
      provider: FALLBACK_AI_PROVIDER,
      usage: createUsage(calls),
    });

    const generated = await intelligence.generate({
      artifact: ARTIFACT,
      profileManifest: PROFILE,
      requestId: "request-1",
      signal: controller.signal,
      snapshot: SNAPSHOT,
      userId: "owner-1",
    });

    assert.equal(generated.provider, "mock-provider");
    assert.equal(generated.model, "mock-recipe-model");
    assert.deepEqual(calls, [
      `${QA_EXECUTION_RECIPE_GENERATION_ACTION}:owner-1`,
      "attempt",
      `provider:${FALLBACK_AI_PROVIDER}:${FALLBACK_AI_MODEL}`,
      "complete:60",
    ]);
  });

  it("tracks review through the separate provider-neutral usage action", async () => {
    const calls: string[] = [];
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText(input) {
        assert.match(input.prompt, /PASSED requires an empty suggestions array/);
        assert.match(input.prompt, /omit absent fields, do not return null or extra fields/);
        assert.match(input.systemInstruction || "", /generation or assessment contract/);
        assert.equal(input.responseMimeType, "application/json");
        assert.deepEqual(input.responseJsonSchema, RECIPE_ASSESSMENT_JSON_SCHEMA);
        assert.match(input.prompt, /suggestions is REQUIRED and must ALWAYS be a JSON array/);
        for (const example of RECIPE_ASSESSMENT_EXAMPLES) {
          assert.ok(input.prompt.includes(JSON.stringify(example)));
        }
        assert.match(input.prompt, /intentional-failure check may be a valid Recipe/);
        return {
          model: "review-model",
          provider: "review-provider",
          text: JSON.stringify({ status: "PASSED", suggestions: [], summary: "Executable." }),
          usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
        };
      },
      usage: createUsage(calls),
    });

    const reviewed = await intelligence.review({
      artifact: ARTIFACT,
      bundle: BUNDLE,
      profileManifest: PROFILE,
      recipeId: "recipe-1",
      requestId: "request-1",
      snapshot: SNAPSHOT,
      userId: "owner-1",
    });

    assert.equal(reviewed.status, "PASSED");
    assert.equal(calls[0], `${QA_EXECUTION_RECIPE_REVIEW_ACTION}:owner-1`);
    assert.equal(calls.at(-1), "complete:40");
  });

  const invalidResponses: Array<{ name: string; change: (bundle: Record<string, any>) => void }> = [
    { name: "missing step refs", change(bundle) { delete bundle.items[0].steps[0].ref; } },
    { name: "guessed locator discriminators", change(bundle) {
      bundle.items[0].steps[1].locator = { type: "label", value: "Email" };
    } },
    { name: "raw fill values", change(bundle) { bundle.items[0].steps[1].value = "synthetic-private-value"; } },
    { name: "top-level expect locators", change(bundle) {
      const step = bundle.items[0].steps[2];
      step.locator = step.expectation.locator;
      delete step.expectation.locator;
    } },
    { name: "unknown action fields", change(bundle) { bundle.items[0].steps[0]["synthetic-private-field"] = "secret"; } },
    { name: "absolute navigation URLs", change(bundle) { bundle.items[0].steps[0].path = "https://example.test/private"; } },
    { name: "duplicate step refs", change(bundle) { bundle.items[0].steps[1].ref = "open_checkout"; } },
    { name: "duplicate checklist IDs", change(bundle) { bundle.items.push(structuredClone(bundle.items[0])); } },
  ];

  for (const invalid of invalidResponses) {
    it(`classifies ${invalid.name} without retaining rejected output or making extra provider calls`, async () => {
      const bundle = structuredClone(BUNDLE);
      invalid.change(bundle);
      const calls: string[] = [];
      const intelligence = createQaExecutionRecipeIntelligence({
        async generateText() {
          calls.push("provider");
          return {
            model: "mock-model",
            provider: "mock-provider",
            text: JSON.stringify({ bundle, title: "synthetic-private-title" }),
            usage: { totalTokens: 60 },
          };
        },
        usage: createUsage(calls),
      });

      await assert.rejects(intelligence.generate(generationInput()), (error: unknown) => {
        assert.ok(error instanceof QaRecipeOutputError);
        assert.equal(error.code, "QA_RECIPE_OUTPUT_INVALID");
        assert.equal(error.expose, false);
        assert.equal(error.diagnostics.stage, "generation");
        assert.ok(error.diagnostics.issues.length > 0);
        assert.doesNotMatch(JSON.stringify(error), /synthetic-private|https:\/\/example\.test|Checkout is visible/);
        if (invalid.name === "missing step refs") {
          assert.deepEqual(error.diagnostics.issues, [{ code: "invalid_type", path: "$.bundle.items.0.steps.0.ref" }]);
        }
        return true;
      });
      assert.equal(calls.filter((call) => call === "provider").length, 1);
      // The provider did real work; validation failure must not erase its usage.
      assert.equal(calls.at(-1), "complete:60");
      assert.equal(calls.includes("failed"), false);
    });
  }

  for (const stage of ["generation", "review"] as const) {
    it(`classifies invalid ${stage} JSON without leaking the raw response`, async () => {
      const intelligence = createQaExecutionRecipeIntelligence({
        async generateText() {
          return { model: "mock", provider: "mock", text: "{synthetic-private-malformed-json" };
        },
        usage: createUsage([]),
      });
      await assert.rejects(
        stage === "generation"
          ? intelligence.generate(generationInput())
          : intelligence.review({ ...generationInput(), bundle: BUNDLE, recipeId: "recipe-1" }),
        (error: unknown) => {
          assert.ok(error instanceof QaRecipeOutputError);
          assert.equal(error.code, stage === "generation" ? "QA_RECIPE_OUTPUT_INVALID" : "QA_RECIPE_REVIEW_INVALID");
          assert.deepEqual(error.diagnostics, { stage, issues: [{ code: "invalid_json", path: "$" }] });
          assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
          return true;
        }
      );
    });
  }

  for (const assessment of [
    { status: "synthetic-private-status", suggestions: [] },
    { status: "SUGGESTIONS", suggestions: [] },
    { status: "PASSED", suggestions: [{ code: "test", severity: "WARNING", message: "synthetic-private-message" }] },
    { status: "PASSED", suggestions: [], summary: null },
    { status: "PASSED" },
    { status: "PASSED", suggestions: null },
    { status: "PASSED", suggestions: "synthetic-private-suggestions" },
    { status: "PASSED", suggestions: {} },
    { status: "SUGGESTIONS", suggestions: null },
  ]) {
    it(`classifies invalid review structure ${JSON.stringify(assessment)}`, async () => {
      const intelligence = createQaExecutionRecipeIntelligence({
        async generateText() { return { model: "mock", provider: "mock", text: JSON.stringify(assessment) }; },
        usage: createUsage([]),
      });
      await assert.rejects(intelligence.review({ ...generationInput(), bundle: BUNDLE, recipeId: "recipe-1" }), (error: unknown) => {
        assert.ok(error instanceof QaRecipeOutputError);
        assert.equal(error.code, "QA_RECIPE_REVIEW_INVALID");
        assert.equal(error.diagnostics.stage, "review");
        assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
        return true;
      });
    });
  }

  it("accepts a valid suggestions assessment without changing its findings or status", async () => {
    const assessment = RECIPE_ASSESSMENT_EXAMPLES[1]!;
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText() { return { model: "mock", provider: "mock", text: JSON.stringify(assessment) }; },
      usage: createUsage([]),
    });
    const reviewed = await intelligence.review({ ...generationInput(), bundle: BUNDLE, recipeId: "recipe-1" });
    assert.deepEqual(reviewed, { ...assessment, model: "mock", provider: "mock" });
  });

  it("rejects 81 provider suggestions locally without retrying or discarding usage", async () => {
    const calls: string[] = [];
    const assessment = {
      status: "SUGGESTIONS",
      suggestions: Array.from({ length: 81 }, (_, index) => ({
        code: `FINDING_${index}`,
        severity: "WARNING",
        message: "synthetic-private-message",
      })),
    };
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText(input) {
        calls.push("provider");
        assert.deepEqual(input.responseJsonSchema, RECIPE_ASSESSMENT_JSON_SCHEMA);
        return {
          model: "mock",
          provider: "mock",
          text: JSON.stringify(assessment),
          usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
        };
      },
      usage: createUsage(calls),
    });

    await assert.rejects(intelligence.review({ ...generationInput(), bundle: BUNDLE, recipeId: "recipe-1" }), (error: unknown) => {
      assert.ok(error instanceof QaRecipeOutputError);
      assert.equal(error.code, "QA_RECIPE_REVIEW_INVALID");
      assert.equal(error.expose, false);
      assert.deepEqual(error.diagnostics, {
        stage: "review",
        issues: [{ code: "too_big", path: "$.suggestions" }],
      });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
      return true;
    });
    assert.deepEqual(calls, [
      `${QA_EXECUTION_RECIPE_REVIEW_ACTION}:owner-1`,
      "attempt",
      "provider",
      "complete:40",
    ]);
  });

  it("accepts literal values and hash navigation without profile keys or silently rewriting a failing assertion", async () => {
    const bundle = structuredClone(BUNDLE);
    const steps = bundle.items[0]!.steps;
    steps[0] = { action: "navigate", ref: "open_login", path: "/#/login", waitUntil: "domcontentloaded" };
    steps[1] = {
      action: "fill", ref: "fill_email", locator: { by: "label", value: "Email" },
      value: { source: "literal", value: "qa-smoke@example.test" },
    };
    steps[2] = {
      action: "expect", ref: "intentional_failure",
      expectation: { kind: "visible", locator: { by: "role", role: "heading", name: "Oddpath smoke marker" } },
    };
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText() {
        return { model: "mock", provider: "mock", text: "```json\n" + JSON.stringify({ bundle, title: "Login recipe" }) + "\n```" };
      },
      usage: createUsage([]),
    });
    const generated = await intelligence.generate({ ...generationInput(), profileManifest: { ...PROFILE, valueReferences: [] } });
    assert.deepEqual(generated.bundle, bundle);
  });

  it("preserves provider failures and usage guards instead of misclassifying them as Recipe errors", async () => {
    const calls: string[] = [];
    const failure = new AppError("Provider unavailable.", 503, "AI_PROVIDER_ERROR");
    const intelligence = createQaExecutionRecipeIntelligence({
      async generateText() { calls.push("provider"); throw failure; },
      usage: createUsage(calls),
    });
    await assert.rejects(intelligence.generate(generationInput()), (error: unknown) => error === failure);
    assert.equal(calls.at(-1), "failed");
    assert.equal(calls.filter((call) => call === "provider").length, 1);

    const denied = new AppError("Usage limit.", 429, "USAGE_LIMIT_REACHED");
    const guarded = createQaExecutionRecipeIntelligence({
      async generateText() { assert.fail("Must not call the provider after reservation denial"); },
      usage: { ...createUsage([]), async reserveAiOperation() { throw denied; } },
    });
    await assert.rejects(guarded.generate(generationInput()), (error: unknown) => error === denied);
  });
});

function generationInput() {
  return {
    artifact: ARTIFACT,
    profileManifest: PROFILE,
    requestId: "request-1",
    snapshot: SNAPSHOT,
    userId: "owner-1",
  };
}

function createUsage(calls: string[]): AiOperationUsageService {
  return {
    async reserveAiOperation(input) {
      calls.push(`${input.action}:${input.userId}`);
      return {
        action: input.action,
        eventId: "usage-1",
        model: input.model,
        provider: input.provider,
        reserved: 10,
      };
    },
    async recordAiOperationAttempt() { calls.push("attempt"); },
    async completeAiOperation(_reservation, completion) {
      calls.push(`complete:${completion?.totalTokens}`);
    },
    async failAiOperation() { calls.push("failed"); },
  };
}

function hasCode(expected: string) {
  return (error: unknown) => Boolean(
    error && typeof error === "object" && "code" in error && error.code === expected
  );
}
