import assert from "node:assert/strict";
import type { Server } from "node:http";
import { describe, it } from "node:test";

import type { ProfileManifestV1, RecipeBundleV1 } from "@oddpath/qa-execution-contract";
import express from "express";

import { createApp } from "../src/app.ts";
import { env } from "../src/config/env.ts";
import { prisma } from "../src/db/prisma.ts";
import { AppError } from "../src/lib/errors.ts";
import { createCsrfToken } from "../src/middleware/csrf.middleware.ts";
import { authService } from "../src/modules/auth/auth.service.ts";
import { qaAgentRouter } from "../src/modules/qa-requests/qa-agent.routes.ts";
import {
  createQaExecutionRecipeRepository,
  hashCanonicalJson,
  resolveProfileManifest,
} from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import { retryQaExecutionRecipeReviewSchema } from "../src/modules/qa-requests/qa-execution-recipes.schema.ts";
import {
  createQaExecutionRecipesService,
  qaExecutionRecipesService,
} from "../src/modules/qa-requests/qa-execution-recipes.service.ts";
import type { QaExecutionRecipeRepository } from "../src/modules/qa-requests/qa-execution-recipes.types.ts";
import type { QaProcessingOperationDto } from "../src/modules/qa-requests/qa-processing.types.ts";

const PROFILE: ProfileManifestV1 = resolveProfileManifest({
  environmentKind: "TEST", evidenceKinds: ["TEXT"], executorKey: "playwright",
  label: "Local test", profileKey: "local-test", recipeSchemaVersions: [1], schemaVersion: 1,
  valueReferences: [],
});
const BUNDLE: RecipeBundleV1 = {
  engine: "playwright", schemaVersion: 1,
  items: [{ checklistItemId: "item-1", steps: [
    { action: "navigate", path: "/#/login", ref: "open-login", waitUntil: "domcontentloaded" },
    { action: "expect", ref: "see-heading", expectation: {
      kind: "visible", locator: { by: "role", name: "Login", role: "heading" },
    } },
  ] }],
};
const INPUT = {
  actor: { kind: "USER" as const, transport: "WEB" as const, userId: "owner-1" },
  assessmentId: "failed-1", projectId: "project-1", recipeId: "recipe-1", requestId: "request-1",
};
const OPERATION: QaProcessingOperationDto = {
  artifactId: "artifact-1", attempts: 0, availableAt: "2026-09-08T00:00:00.000Z",
  completedAt: null, errorCode: null, kind: "EXECUTION_RECIPE_REVIEW", operationId: "retry-1",
  recipeId: "recipe-1", requestId: "request-1", status: "PENDING",
};

describe("owner Recipe review retry contract", () => {
  it("accepts only an exact bounded assessment identifier", () => {
    assert.deepEqual(retryQaExecutionRecipeReviewSchema.parse({ assessmentId: " failed-1 " }), {
      assessmentId: "failed-1",
    });
    for (const input of [{}, { assessmentId: "" }, { assessmentId: "x".repeat(121) },
      { assessmentId: "failed-1", profileManifest: PROFILE },
      { assessmentId: "failed-1", bundle: BUNDLE }, { assessmentId: "failed-1", recipeHash: "other" }]) {
      assert.equal(retryQaExecutionRecipeReviewSchema.safeParse(input).success, false);
    }
  });

  it("checks owner access before queuing and returns the existing operation receipt", async () => {
    const calls: string[] = [];
    let deny = false;
    const service = createQaExecutionRecipesService({
      projectAccess: { async assertProjectAccess(userId, projectId) {
        calls.push(`access:${userId}:${projectId}`);
        if (deny) throw new AppError("Not found.", 404, "PROJECT_NOT_FOUND");
      } },
      repository: { async queueReviewRetry(input) {
        assert.deepEqual(input, INPUT);
        calls.push("queue");
        return OPERATION.operationId;
      } } as QaExecutionRecipeRepository,
      processingRepository: {
        async getOperation(projectId, operationId) {
          assert.equal(projectId, INPUT.projectId);
          assert.equal(operationId, OPERATION.operationId);
          calls.push("receipt");
          return OPERATION;
        },
        async getRequestOperation() { assert.fail("Retry must retrieve the exact returned operation."); },
      },
    });
    assert.deepEqual(await service.retryRecipeReview("owner-1", "project-1", "request-1", "recipe-1", {
      assessmentId: "failed-1",
    }), { operation: OPERATION });
    assert.deepEqual(calls, ["access:owner-1:project-1", "queue", "receipt"]);
    deny = true;
    await assert.rejects(service.retryRecipeReview("other-owner", "project-1", "request-1", "recipe-1", {
      assessmentId: "failed-1",
    }), hasCode("PROJECT_NOT_FOUND"));
    assert.equal(calls.filter((call) => call === "queue").length, 1);
  });

  it("mounts only the cookie-authenticated CSRF-protected owner route", async (t) => {
    const received: unknown[][] = [];
    t.mock.method(authService, "getCurrentUser", async () => ({
      createdAt: "2026-09-08T00:00:00.000Z", email: "owner@example.test",
      emailVerifiedAt: null, id: "owner-1", locale: "en", name: null,
    }));
    t.mock.method(qaExecutionRecipesService, "retryRecipeReview", async (...args: unknown[]) => {
      received.push(args);
      return { operation: OPERATION };
    });
    const csrf = createCsrfToken();
    const path = "/api/projects/project-1/qa/requests/request-1/execution-recipes/recipe-1/review/retry";
    const csrfHeaders = { [env.csrfHeaderName]: csrf, cookie: `${env.csrfCookieName}=${csrf}` };
    await withServer(createApp(), async (url) => {
      const post = (headers: Record<string, string>, body = { assessmentId: "failed-1" }) => fetch(url + path, {
        body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers }, method: "POST",
      });
      assert.equal((await post({ cookie: "qa_session=test-session" })).status, 403);
      assert.equal((await post(csrfHeaders)).status, 401);
      assert.equal((await post({ ...csrfHeaders, authorization: "Bearer agent-token" })).status, 401);
      const ownerHeaders = { ...csrfHeaders, cookie: `${csrfHeaders.cookie}; qa_session=test-session` };
      assert.equal((await post(ownerHeaders, { assessmentId: "" })).status, 400);
      const response = await post(ownerHeaders);
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { operation: OPERATION });
    });
    assert.deepEqual(received, [["owner-1", "project-1", "request-1", "recipe-1", { assessmentId: "failed-1" }]]);

    const agentApp = express();
    agentApp.use((req, _res, next) => {
      req.qaIntegration = {
        connectionId: "agent-1", ownerId: "owner-1", projectId: "project-1",
        scopes: ["qa:read", "qa:write", "evidence:write"],
      };
      next();
    });
    agentApp.use(express.json(), qaAgentRouter);
    await withServer(agentApp, async (url) => {
      const response = await fetch(url + path.replace("/api", ""), {
        body: JSON.stringify({ assessmentId: "failed-1" }),
        headers: { "content-type": "application/json" }, method: "POST",
      });
      assert.equal(response.status, 404);
    });
    assert.equal(received.length, 1);
  });
});

describe("transactional Recipe review retry", () => {
  it("appends a pending assessment and fresh review operation without changing the immutable Recipe or failure", async () => {
    const fixture = createFixture();
    const originalRecipe = structuredClone(fixture.state.recipe);
    const originalFailure = structuredClone(fixture.state.assessments[0]);
    const originalOperation = structuredClone(fixture.state.operations[0]);
    const operationId = await fixture.repository.queueReviewRetry(INPUT);
    assert.deepEqual(fixture.state.recipe, originalRecipe);
    assert.deepEqual(fixture.state.assessments[0], originalFailure);
    assert.deepEqual(fixture.state.operations[0], originalOperation);
    assert.equal(fixture.state.assessments.length, 2);
    const pending = fixture.state.assessments[1]!;
    assert.equal(pending.status, "PENDING");
    assert.ok(pending.createdAt > originalFailure!.createdAt);
    assert.equal(fixture.state.operations.length, 2);
    const operation = fixture.state.operations[1]!;
    assert.equal(operation.id, operationId);
    assert.equal(operation.kind, "EXECUTION_RECIPE_REVIEW");
    assert.equal(operation.attempts, 0);
    assert.equal(operation.recipeId, "recipe-1");
    assert.equal(operation.artifactId, "artifact-1");
    assert.deepEqual(operation.profileManifest, originalRecipe.profileManifest);
    assert.equal(operation.profileManifestHash, originalRecipe.profileManifestHash);
    assert.equal(operation.idempotencyKeyHash, hashCanonicalJson({
      assessmentId: "failed-1", intent: "execution-recipe-review-retry-v1", recipeId: "recipe-1",
    }));
    assert.equal(fixture.state.events.length, 1);
    assert.deepEqual(fixture.state.events[0]!.metadata, {
      assessmentId: pending.id, failedAssessmentId: "failed-1", operationId,
      recipeHash: originalRecipe.recipeHash, recipeId: "recipe-1",
    });
    assert.deepEqual(fixture.reads.slice(0, 2), ["lock", "owner-scoped-request"]);
  });

  it("deduplicates concurrent clicks and replays even terminal retries without any new records", async () => {
    const fixture = createFixture();
    const ids = await Promise.all(Array.from({ length: 8 }, () => fixture.repository.queueReviewRetry(INPUT)));
    assert.equal(new Set(ids).size, 1);
    for (const status of ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"]) {
      fixture.state.operations[1]!.status = status;
      fixture.state.request.phase = "RUNNING";
      assert.equal(await fixture.repository.queueReviewRetry(INPUT), ids[0]);
    }
    assert.equal(fixture.state.assessments.length, 2);
    assert.equal(fixture.state.operations.length, 2);
    assert.equal(fixture.state.events.length, 1);
  });

  it("enforces owner, project, request, Recipe, selected-artifact and phase scope under the lock", async () => {
    for (const [input, code] of [
      [{ ...INPUT, actor: { ...INPUT.actor, userId: "other-owner" } }, "QA_REQUEST_NOT_FOUND"],
      [{ ...INPUT, projectId: "other-project" }, "QA_REQUEST_NOT_FOUND"],
      [{ ...INPUT, requestId: "other-request" }, "QA_REQUEST_NOT_FOUND"],
      [{ ...INPUT, recipeId: "other-recipe" }, "QA_EXECUTION_RECIPE_NOT_FOUND"],
    ] as const) {
      const fixture = createFixture();
      await assert.rejects(fixture.repository.queueReviewRetry(input), hasCode(code));
      assert.equal(fixture.state.assessments.length, 1);
    }
    for (const kind of ["INTEGRATION", "SYSTEM"] as const) {
      const fixture = createFixture();
      await assert.rejects(fixture.repository.queueReviewRetry({ ...INPUT, actor: { ...INPUT.actor, kind } }),
        hasCode("QA_RECIPE_REVIEW_OWNER_REQUIRED"));
    }
    for (const phase of ["DRAFT", "RUNNING", "READY_FOR_REVIEW", "APPROVED"]) {
      const fixture = createFixture();
      fixture.state.request.phase = phase;
      await assert.rejects(fixture.repository.queueReviewRetry(INPUT), hasCode("QA_RECIPE_PHASE_INVALID"));
    }
    const fixture = createFixture();
    fixture.state.request.selectedArtifactId = "other-artifact";
    await assert.rejects(fixture.repository.queueReviewRetry(INPUT), hasCode("QA_RECIPE_ARTIFACT_NOT_SELECTED"));
  });

  it("requires the exact latest FAILED assessment and refuses an already active review", async () => {
    for (const status of ["PENDING", "PASSED", "SUGGESTIONS"]) {
      const fixture = createFixture();
      fixture.state.assessments[0]!.status = status;
      await assert.rejects(fixture.repository.queueReviewRetry(INPUT), hasCode("QA_RECIPE_REVIEW_RETRY_INVALID"));
    }
    const stale = createFixture();
    await assert.rejects(stale.repository.queueReviewRetry({ ...INPUT, assessmentId: "stale-assessment" }),
      hasCode("QA_RECIPE_REVIEW_RETRY_INVALID"));
    for (const status of ["PENDING", "PROCESSING"]) {
      const fixture = createFixture();
      fixture.state.operations[0]!.status = status;
      await assert.rejects(fixture.repository.queueReviewRetry(INPUT), hasCode("QA_RECIPE_REVIEW_IN_PROGRESS"));
      assert.equal(fixture.state.assessments.length, 1);
    }
  });

  it("rejects a mismatched stored profile hash without replacing the stored profile", async () => {
    const fixture = createFixture();
    fixture.state.recipe.profileManifestHash = "b".repeat(64);
    await assert.rejects(fixture.repository.queueReviewRetry(INPUT), hasCode("QA_PROFILE_MANIFEST_HASH_INVALID"));
    assert.equal(fixture.state.assessments.length, 1);
  });

  for (const failure of ["operation", "event"] as const) {
    it(`rolls back the entire retry when the ${failure} write fails`, async () => {
      const fixture = createFixture();
      const before = structuredClone(fixture.state);
      fixture.failures[failure] = true;
      await assert.rejects(fixture.repository.queueReviewRetry(INPUT), /synthetic write failure/);
      assert.deepEqual(fixture.state, before);
    });
  }

  it("does not auto-review an identical agent submission before or after an owner retry", async () => {
    const fixture = createFixture();
    const submit = () => fixture.repository.submitRecipe({
      actor: { kind: "INTEGRATION", transport: "REST", userId: "owner-1" },
      artifactId: "artifact-1", bundle: BUNDLE, origin: "AGENT_PROVIDED", profileManifest: PROFILE,
      projectId: "project-1", requestId: "request-1", title: "Same recipe",
    });
    assert.equal(await submit(), "recipe-1");
    assert.equal(fixture.state.operations.length, 1);
    await fixture.repository.queueReviewRetry(INPUT);
    assert.equal(await submit(), "recipe-1");
    assert.equal(fixture.state.assessments.length, 2);
    assert.equal(fixture.state.operations.length, 2);
  });

  it("fences stale completion and failure workers from the new assessment and completes only the current lease", async () => {
    const fixture = createFixture();
    const operationId = await fixture.repository.queueReviewRetry(INPUT);
    const originalFailure = structuredClone(fixture.state.assessments[0]);
    const processing = { executionId: operationId, leaseToken: "retry-lease" };
    Object.assign(fixture.state.operations[1]!, {
      leaseExpiresAt: new Date(Date.now() + 60_000), leaseToken: processing.leaseToken, status: "PROCESSING",
    });
    const input = { ...INPUT, processing: { executionId: "original-review", leaseToken: "old-lease" } };
    await assert.rejects(fixture.repository.completeAssessment({ ...input, status: "PASSED", suggestions: [] }),
      hasCode("QA_PROCESSING_LEASE_LOST"));
    await assert.rejects(fixture.repository.failAssessment({ ...input, errorCode: "OLD_FAILURE" }),
      hasCode("QA_PROCESSING_LEASE_LOST"));
    await assert.rejects(fixture.repository.completeAssessment({
      ...INPUT, processing: { ...processing, leaseToken: "stale-retry-lease" }, status: "PASSED", suggestions: [],
    }), hasCode("QA_PROCESSING_LEASE_LOST"));
    assert.equal(fixture.state.assessments[1]!.status, "PENDING");
    await fixture.repository.completeAssessment({ ...INPUT, processing, status: "PASSED", suggestions: [] });
    assert.deepEqual(fixture.state.assessments[0], originalFailure);
    assert.equal(fixture.state.assessments[1]!.status, "PASSED");
    assert.equal(fixture.state.operations[1]!.status, "SUCCEEDED");
    assert.equal(await fixture.repository.queueReviewRetry(INPUT), operationId);
  });

  it("rolls back an assessment update if its processing lease is lost during completion", async () => {
    const fixture = createFixture();
    const operationId = await fixture.repository.queueReviewRetry(INPUT);
    Object.assign(fixture.state.operations[1]!, {
      leaseExpiresAt: new Date(Date.now() + 60_000), leaseToken: "retry-lease", status: "PROCESSING",
    });
    fixture.failures.finishLease = true;
    const before = structuredClone(fixture.state);
    await assert.rejects(fixture.repository.completeAssessment({
      ...INPUT, processing: { executionId: operationId, leaseToken: "retry-lease" }, status: "PASSED", suggestions: [],
    }), hasCode("QA_PROCESSING_LEASE_LOST"));
    assert.deepEqual(fixture.state, before);
  });
});

function createFixture() {
  type Row = Record<string, any>;
  const state = {
    request: { id: "request-1", projectId: "project-1", ownerId: "owner-1", phase: "READY_TO_RUN", selectedArtifactId: "artifact-1" },
    recipe: {
      artifactId: "artifact-1", canonicalJson: BUNDLE, id: "recipe-1", profileManifest: PROFILE,
      profileManifestHash: PROFILE.manifestHash!, recipeHash: hashCanonicalJson(BUNDLE), requestId: "request-1", revision: 1,
    },
    assessments: [{
      completedAt: new Date("2026-09-08T00:00:01Z"), createdAt: new Date("2026-09-08T00:00:00Z"),
      errorCode: "QA_RECIPE_REVIEW_INVALID", id: "failed-1", recipeId: "recipe-1", status: "FAILED", suggestions: [],
    }] as Row[],
    operations: [{
      artifactId: "artifact-1", attempts: 3, id: "original-review", idempotencyKeyHash: null,
      kind: "EXECUTION_RECIPE_REVIEW", leaseToken: null, leaseExpiresAt: null,
      errorCode: "QA_RECIPE_REVIEW_INVALID", recipeId: "recipe-1", requestId: "request-1", status: "FAILED",
    }] as Row[],
    events: [] as Row[],
  };
  const failures = { event: false, operation: false, finishLease: false };
  const reads: string[] = [];
  const tx = {
    async $executeRaw() { reads.push("lock"); return 0; },
    qaRequest: { async findFirst({ where }: Row) {
      reads.push(where.project ? "owner-scoped-request" : "request");
      return where.id === state.request.id && where.projectId === state.request.projectId
        && (!where.project || where.project.ownerId === state.request.ownerId) ? state.request : null;
    } },
    qaArtifact: { async findFirst() { return {
      id: "artifact-1", items: [{ id: "item-1", title: "Login", evidenceRequirements: [
        { id: "text-1", kind: "TEXT", required: true, description: "Record the heading" },
      ] }],
    }; } },
    qaExecutionRecipe: { async findFirst({ where }: Row) {
      return (!where.id || where.id === state.recipe.id)
        && (!where.requestId || where.requestId === state.recipe.requestId)
        && (!where.request || where.request.projectId === state.request.projectId)
        && (!where.artifactId || where.artifactId === state.recipe.artifactId)
        && (!where.recipeHash || where.recipeHash === state.recipe.recipeHash) ? state.recipe : null;
    } },
    qaExecutionRecipeAssessment: {
      async findFirst() { return state.assessments.at(-1) || null; },
      async create({ data }: Row) {
        const row = { ...data, id: `assessment-${state.assessments.length + 1}` };
        state.assessments.push(row);
        return row;
      },
      async update({ data, where }: Row) {
        const row = state.assessments.find(({ id }) => id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    qaGenerationExecution: {
      async findFirst({ where }: Row) {
        return state.operations.find((operation) => Object.entries(where).every(([key, value]) => {
          if (value === undefined) return true;
          if (key === "status" && typeof value === "object") return (value as Row).in.includes(operation.status);
          if (key === "leaseExpiresAt") return operation.leaseExpiresAt && operation.leaseExpiresAt > (value as Row).gt;
          return operation[key] === value;
        })) || null;
      },
      async create({ data }: Row) {
        if (failures.operation) throw new Error("synthetic write failure");
        const row = { ...data, attempts: 0, id: `operation-${state.operations.length + 1}`, status: "PENDING" };
        state.operations.push(row);
        return row;
      },
      async updateMany({ data, where }: Row) {
        if (failures.finishLease) return { count: 0 };
        const row = state.operations.find((operation) => Object.entries(where).every(([key, value]) => operation[key] === value));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    qaWorkflowEvent: {
      async findFirst() { return state.events.at(-1) || null; },
      async create({ data }: Row) {
        if (failures.event) throw new Error("synthetic write failure");
        state.events.push(data);
        return data;
      },
    },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const database = {
    $transaction<T>(action: (transaction: typeof tx) => Promise<T>) {
      const result = tail.then(async () => {
        const before = structuredClone(state);
        try { return await action(tx); }
        catch (error) { Object.assign(state, before); throw error; }
      });
      tail = result.catch(() => undefined);
      return result;
    },
  } as unknown as typeof prisma;
  return { failures, reads, repository: createQaExecutionRecipeRepository(database), state };
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

async function withServer(app: express.Express, action: (url: string) => Promise<void>) {
  let server: Server | undefined;
  const url = await new Promise<string>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  try { await action(url); }
  finally { await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); }
}
