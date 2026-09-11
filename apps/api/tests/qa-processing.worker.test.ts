import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import { createQaProcessingWorker } from "../src/modules/qa-requests/qa-processing.worker.ts";
import { QaRecipeOutputError } from "../src/modules/qa-requests/qa-recipe-output.ts";
import type {
  ClaimedQaProcessingJob,
  QaProcessingHandlers,
  QaProcessingRepository,
} from "../src/modules/qa-requests/qa-processing.types.ts";

const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("QA asynchronous processing worker", () => {
  it("retries a transient provider failure with bounded backoff", async () => {
    const calls: string[] = [];
    const repository = createRepository(job({ attempts: 1 }), calls);
    const worker = createQaProcessingWorker({
      handlers: {
        CHECKLIST_GENERATION: {
          async fail() { calls.push("handler:fail"); },
          async run() { throw new AppError("Try again.", 503, "AI_TEMPORARY"); },
        },
      },
      maxAttempts: 3,
      now: () => NOW,
      random: () => 0,
      repository,
    });

    const summary = await worker.runOnce({ concurrency: 1 });

    assert.equal(summary.retried, 1);
    assert.deepEqual(calls, [
      "claim:CHECKLIST_GENERATION",
      "retry:AI_TEMPORARY:2026-08-30T12:00:05.000Z",
      "count:2026-08-30T12:00:00.000Z",
    ]);
  });

  it("aborts timed-out work and records a terminal timeout at the last attempt", async () => {
    const calls: string[] = [];
    const repository = createRepository(job({ attempts: 3 }), calls);
    const worker = createQaProcessingWorker({
      handlers: {
        CHECKLIST_GENERATION: {
          async fail(_job, errorCode) { calls.push(`handler:fail:${errorCode}`); },
          async run(_job, signal) {
            await new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
          },
        },
      },
      maxAttempts: 3,
      providerTimeoutMs: 5,
      repository,
    });

    const summary = await worker.runOnce({ concurrency: 1 });

    assert.equal(summary.failed, 1);
    assert.ok(calls.includes("handler:fail:AI_TIMEOUT"));
    assert.equal(calls.some((call) => call.startsWith("retry:")), false);
  });

  it("processes a stale job reclaimed by the repository under a fresh lease", async () => {
    const calls: string[] = [];
    const staleJob = job({
      attempts: 2,
      leaseExpiresAt: new Date("2026-08-30T11:59:59.000Z"),
      leaseToken: "fresh-lease",
    });
    const repository = createRepository(staleJob, calls);
    const worker = createQaProcessingWorker({
      handlers: {
        CHECKLIST_GENERATION: {
          async fail() { throw new Error("unexpected failure"); },
          async run(claimed) { calls.push(`run:${claimed.attempts}:${claimed.leaseToken}`); },
        },
      },
      now: () => NOW,
      repository,
    });

    const summary = await worker.runOnce({ concurrency: 1 });

    assert.equal(summary.processed, 1);
    assert.ok(calls.includes("run:2:fresh-lease"));
  });

  it("terminally fences a claimed kind when its handler is unavailable", async () => {
    const calls: string[] = [];
    const repository = createRepository(job(), calls);
    const handlers = { CHECKLIST_GENERATION: undefined } as QaProcessingHandlers;
    const worker = createQaProcessingWorker({ handlers, repository });

    const summary = await worker.runOnce({ concurrency: 1 });

    assert.equal(summary.failed, 1);
    assert.ok(calls.includes("terminal:QA_PROCESSING_HANDLER_MISSING"));
  });

  for (const stage of ["generation", "review"] as const) {
    for (const attempts of [1, 3]) {
      it(`preserves ${stage} validation diagnostics on ${attempts === 1 ? "retry" : "terminal failure"} without logging private content`, async () => {
        const calls: string[] = [];
        const logs: string[] = [];
        const kind = stage === "generation" ? "EXECUTION_RECIPE_GENERATION" : "EXECUTION_RECIPE_REVIEW";
        const errorCode = stage === "generation" ? "QA_RECIPE_OUTPUT_INVALID" : "QA_RECIPE_REVIEW_INVALID";
        const error = new QaRecipeOutputError(stage, [{
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: stage === "generation" ? ["bundle", "items", 0, "steps", 0, "ref"] : ["suggestions", 0, "message"],
          message: "synthetic-private-issue-message",
        }]);
        error.message = "synthetic-private-error-message";
        error.stack = "synthetic-private-error-stack";
        Object.assign(error, { rawResponse: "synthetic-private-provider-response" });
        const claimed = job({
          attempts,
          kind,
          leaseToken: "synthetic-private-lease-token",
          profileManifest: { untrusted: "synthetic-private-profile" },
          requestId: "synthetic-private-request-id",
        });
        const worker = createQaProcessingWorker({
          handlers: {
            [kind]: {
              async fail(_job: ClaimedQaProcessingJob, code: string) { calls.push(`handler:fail:${code}`); },
              async run() { calls.push("handler:run"); throw error; },
            },
          },
          logger: { warn(message: string) { logs.push(message); } },
          maxAttempts: 3,
          now: () => NOW,
          random: () => 0,
          repository: createRepository(claimed, calls),
        });

        const summary = await worker.runOnce({ concurrency: 1 });

        assert.equal(calls.filter((call) => call === "handler:run").length, 1);
        assert.equal(summary.retried, attempts === 1 ? 1 : 0);
        assert.equal(summary.failed, attempts === 3 ? 1 : 0);
        assert.equal(calls.some((call) => call.startsWith(`retry:${errorCode}:`)), attempts === 1);
        assert.equal(calls.includes(`handler:fail:${errorCode}`), attempts === 3);
        assert.equal(calls.some((call) => call.includes("QA_PROCESSING_FAILED")), false);
        assert.deepEqual(logs.map((message) => JSON.parse(message)), [{
          event: "qa_processing_output_invalid",
          operationId: "operation-1",
          kind,
          attempt: attempts,
          errorCode,
          diagnostics: {
            stage,
            issues: [{
              code: "invalid_type",
              path: stage === "generation" ? "$.bundle.items.0.steps.0.ref" : "$.suggestions.0.message",
            }],
          },
        }]);
        assert.doesNotMatch(logs.join("\n"), /synthetic-private/);
      });
    }
  }

  it("does not trust diagnostic-shaped properties on unrelated errors", async () => {
    const logs: string[] = [];
    for (const error of [
      new Error("synthetic-private-unknown-error"),
      new AppError("synthetic-private-app-error", 502, "AI_PROVIDER_ERROR"),
    ]) {
      Object.assign(error, {
        diagnostics: { stage: "generation", issues: [{ code: "invalid_type", path: "synthetic-private-path" }] },
      });
      const calls: string[] = [];
      const worker = createQaProcessingWorker({
        handlers: {
          EXECUTION_RECIPE_GENERATION: {
            async fail(_job, errorCode) { calls.push(`handler:fail:${errorCode}`); },
            async run() { throw error; },
          },
        },
        logger: { warn(message: string) { logs.push(message); } },
        maxAttempts: 3,
        repository: createRepository(job({ attempts: 3, kind: "EXECUTION_RECIPE_GENERATION" }), calls),
      });

      const summary = await worker.runOnce({ concurrency: 1 });

      assert.equal(summary.failed, 1);
      assert.ok(calls.includes(`handler:fail:${error instanceof AppError ? error.code : "QA_PROCESSING_FAILED"}`));
    }
    assert.deepEqual(logs, []);
  });

  for (const attempts of [1, 3]) {
    it(`still ${attempts === 1 ? "schedules the bounded retry" : "records terminal failure"} when diagnostic logging fails`, async () => {
      const calls: string[] = [];
      const worker = createQaProcessingWorker({
        handlers: {
          EXECUTION_RECIPE_REVIEW: {
            async fail(_job, code) { calls.push(`handler:fail:${code}`); },
            async run() { throw new QaRecipeOutputError("review", "invalid_json"); },
          },
        },
        logger: { warn() { throw new Error("synthetic-private-logger-failure"); } },
        maxAttempts: 3,
        now: () => NOW,
        random: () => 0,
        repository: createRepository(job({ attempts, kind: "EXECUTION_RECIPE_REVIEW" }), calls),
      });

      const summary = await worker.runOnce({ concurrency: 1 });

      assert.equal(summary.retried, attempts === 1 ? 1 : 0);
      assert.equal(summary.failed, attempts === 3 ? 1 : 0);
      assert.equal(calls.includes("retry:QA_RECIPE_REVIEW_INVALID:2026-08-30T12:00:05.000Z"), attempts === 1);
      assert.equal(calls.includes("handler:fail:QA_RECIPE_REVIEW_INVALID"), attempts === 3);
    });
  }
});

function job(overrides: Partial<ClaimedQaProcessingJob> = {}): ClaimedQaProcessingJob {
  return {
    artifactId: null,
    attempts: 1,
    id: "operation-1",
    kind: "CHECKLIST_GENERATION",
    leaseExpiresAt: new Date("2026-08-30T12:01:00.000Z"),
    leaseToken: "lease-token",
    profileManifest: null,
    profileManifestHash: null,
    recipeId: null,
    requestId: "request-1",
    ...overrides,
  };
}

function createRepository(
  claimed: ClaimedQaProcessingJob,
  calls: string[]
): QaProcessingRepository {
  let available = true;
  return {
    async claimNext(input) {
      calls.push(`claim:${input.kinds.join(",")}`);
      if (!available) return null;
      available = false;
      return claimed;
    },
    async countQueue(now) {
      calls.push(`count:${now.toISOString()}`);
      return { pending: 0, processing: 0, stale: 0 };
    },
    async getOperation() { return null; },
    async getRequestOperation() { return null; },
    async markTerminal(input) {
      calls.push(`terminal:${input.errorCode}`);
      return true;
    },
    async scheduleRetry(input) {
      calls.push(`retry:${input.errorCode}:${input.availableAt.toISOString()}`);
      return true;
    },
  };
}
