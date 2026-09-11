import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toPublicQaRequest } from "../src/modules/qa-requests/qa-request.dto.ts";

describe("QA request public DTO", () => {
  it("removes processing and execution lease internals while keeping safe progress", () => {
    const output = toPublicQaRequest({
      artifacts: [{ id: "artifact-1", items: [{ id: "item-1" }, { id: "item-2" }] }],
      executions: [{
        artifactId: "artifact-1",
        attempts: 2,
        availableAt: new Date("2026-08-30T12:00:00.000Z"),
        completedAt: null,
        errorCode: null,
        id: "operation-1",
        kind: "EXECUTION_RECIPE_REVIEW",
        leaseToken: "processing-secret",
        recipeId: "recipe-1",
        requestId: "request-1",
        status: "PROCESSING",
      }],
      id: "request-1",
      runs: [{
        artifactId: "artifact-1",
        executionJob: {
          claimId: "claim-secret",
          completedAt: null,
          createdAt: new Date("2026-08-30T12:00:00.000Z"),
          errorCode: null,
          errorMessage: null,
          id: "execution-1",
          leaseTokenHash: "lease-hash-secret",
          profileKey: "checkout-test",
          recipeId: "recipe-1",
          runnerRegistrationId: "runner-1",
          status: "RUNNING",
          updatedAt: new Date("2026-08-30T12:00:01.000Z"),
        },
        id: "run-1",
        results: [{ checklistItemId: "item-1" }],
      }],
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(output);
    assert.equal(serialized.includes("processing-secret"), false);
    assert.equal(serialized.includes("claim-secret"), false);
    assert.equal(serialized.includes("lease-hash-secret"), false);
    assert.equal("executions" in output, false);
    assert.deepEqual(output.operations, [{
      artifactId: "artifact-1",
      attempts: 2,
      availableAt: null,
      completedAt: null,
      errorCode: null,
      kind: "EXECUTION_RECIPE_REVIEW",
      operationId: "operation-1",
      recipeId: "recipe-1",
      requestId: "request-1",
      status: "PROCESSING",
    }]);
    const runs = output.runs as Array<Record<string, unknown>>;
    assert.deepEqual(runs[0]?.executionJob, {
      completedAt: null,
      completedItems: 1,
      createdAt: "2026-08-30T12:00:00.000Z",
      failureCode: null,
      failureMessage: null,
      id: "execution-1",
      profileKey: "checkout-test",
      recipeId: "recipe-1",
      runId: "run-1",
      runnerRegistrationId: "runner-1",
      status: "RUNNING",
      totalItems: 2,
      updatedAt: "2026-08-30T12:00:01.000Z",
    });
  });
});
