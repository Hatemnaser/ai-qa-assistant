import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  cancelQaExecution,
  createProjectConnection,
  createQaRequest,
  fetchQaOperation,
  generateQaExecutionRecipe,
  retryQaExecutionRecipeReview,
  startQaRun,
} from "../src/features/qa/qaApi.ts";
import type { QaProfileManifest } from "../src/features/qa/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("QA harness API", () => {
  it("preserves the asynchronous checklist operation returned at request creation", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project-1/qa/requests");
      assert.equal(init?.method, "POST");
      return jsonResponse({
        operation: operation("checklist-op", "CHECKLIST_GENERATION"),
        request: { id: "request-1", phase: "GENERATING" },
      });
    });

    const result = await createQaRequest("project-1", {
      checklistMode: "ODDPATH_GENERATED",
      objective: "Verify checkout",
      title: "Checkout QA",
    });

    assert.equal(result.request.id, "request-1");
    assert.equal(result.operation?.operationId, "checklist-op");
  });

  it("generates a Recipe against the exact public Runner profile manifest", async () => {
    const manifest = profileManifest();
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project-1/qa/requests/request-1/execution-recipes/generate");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        artifactId: "artifact-1",
        profileManifest: manifest,
      });
      return jsonResponse({ operation: operation("recipe-op", "EXECUTION_RECIPE_GENERATION") });
    });

    const receipt = await generateQaExecutionRecipe("project-1", "request-1", {
      artifactId: "artifact-1",
      profileManifest: manifest,
    });

    assert.equal(receipt.operationId, "recipe-op");
  });

  it("polls operation state through the project-owner endpoint", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project-1/qa/operations/operation%2F1");
      assert.equal(init?.method, "GET");
      return jsonResponse({ operation: operation("operation/1", "EXECUTION_RECIPE_REVIEW") });
    });

    const receipt = await fetchQaOperation("project-1", "operation/1");
    assert.equal(receipt.kind, "EXECUTION_RECIPE_REVIEW");
  });

  it("retries the exact Recipe assessment with owner credentials and preserves the 202 receipt", async () => {
    const expectedReceipt = {
      ...operation("review-retry-op", "EXECUTION_RECIPE_REVIEW"),
      recipeId: "recipe/1",
      requestId: "request/1",
    };
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project%2F1/qa/requests/request%2F1/execution-recipes/recipe%2F1/review/retry");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), { assessmentId: "assessment/failed" });
      return jsonResponse({ operation: expectedReceipt }, 202);
    });

    assert.deepEqual(await retryQaExecutionRecipeReview("project/1", "request/1", "recipe/1", {
      assessmentId: "assessment/failed",
    }), expectedReceipt);
  });

  it("rejects a missing retry receipt and preserves stale-assessment API failures", async () => {
    mockFetch(async () => jsonResponse({}, 202));
    await assert.rejects(retryQaExecutionRecipeReview("project-1", "request-1", "recipe-1", {
      assessmentId: "assessment-1",
    }), /invalid review operation receipt/);

    mockFetch(async () => jsonResponse({ code: "QA_RECIPE_REVIEW_STALE", message: "Reload this Recipe." }, 409));
    await assert.rejects(retryQaExecutionRecipeReview("project-1", "request-1", "recipe-1", {
      assessmentId: "assessment-1",
    }), { code: "QA_RECIPE_REVIEW_STALE", status: 409 });
  });

  it("binds Playwright start approval to request version, Recipe hash, and Runner profile", async () => {
    const recipeHash = "a".repeat(64);
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project-1/qa/requests/request-1/runs");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        confirmProduction: true,
        executionMode: "PLAYWRIGHT",
        expectedRequestVersion: 7,
        profileKey: "staging",
        recipeHash,
        recipeId: "recipe-1",
        runnerRegistrationId: "runner-1",
        sourceLabel: "Oddpath Playwright",
      });
      return jsonResponse({ request: { id: "request-1" }, runId: "run-1" });
    });

    const result = await startQaRun("project-1", "request-1", {
      confirmProduction: true,
      executionMode: "PLAYWRIGHT",
      expectedRequestVersion: 7,
      profileKey: "staging",
      recipeHash,
      recipeId: "recipe-1",
      runnerRegistrationId: "runner-1",
    });

    assert.equal(result.runId, "run-1");
  });

  it("uses a Runner-scoped connection preset and the supported cancel route", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    mockFetch(async (input, init) => {
      calls.push({ input, init });
      if (String(input).endsWith("/connections")) {
        return jsonResponse({ connection: { id: "connection-1" }, token: "odp_live_token" });
      }
      return jsonResponse({ request: { id: "request-1" } });
    });

    await createProjectConnection("project-1", "Laptop Runner", "RUNNER");
    await cancelQaExecution("project-1", "request-1", "run/1");

    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { name: "Laptop Runner", preset: "RUNNER" });
    assert.equal(calls[1]?.input, "/api/projects/project-1/qa/requests/request-1/runs/run%2F1/cancel");
  });
});

function operation(
  operationId: string,
  kind: "CHECKLIST_GENERATION" | "EXECUTION_RECIPE_GENERATION" | "EXECUTION_RECIPE_REVIEW"
) {
  return { kind, operationId, requestId: "request-1", status: "PENDING" };
}

function profileManifest(): QaProfileManifest {
  return {
    environmentKind: "STAGING",
    evidenceKinds: ["TEXT", "SCREENSHOT"],
    executorKey: "playwright",
    label: "Staging",
    manifestHash: "b".repeat(64),
    profileKey: "staging",
    recipeSchemaVersions: [1],
    schemaVersion: 1,
    valueReferences: [{ key: "account.email", secret: true }],
  };
}

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = createCsrfAwareFetch(handler);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
