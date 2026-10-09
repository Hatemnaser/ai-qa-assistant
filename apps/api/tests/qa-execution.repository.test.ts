import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExecutionTaskV1 } from "@oddpath/qa-execution-contract";

import { prisma } from "../src/db/prisma.ts";
import { createQaExecutionRepository } from "../src/modules/qa-requests/qa-execution.repository.ts";
import { resolveProfileManifest } from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const CLAIM_INPUT = {
  actor: {
    connectionTokenId: "connection-1",
    kind: "INTEGRATION" as const,
    transport: "REST" as const,
    userId: "owner-1",
  },
  connectionTokenId: "connection-1",
  leaseExpiresAt: new Date("2026-08-30T12:00:45.000Z"),
  leaseToken: "x".repeat(43),
  request: { instanceId: "instance-1", registrationId: "registration-1" },
};

describe("QA execution repository concurrency guards", () => {
  it("re-reads an execution after the request lock before cancelling it", async () => {
    const calls: string[] = [];
    let reads = 0;
    const tx = {
      async $executeRaw(strings: TemplateStringsArray) {
        const sql = strings.join("");
        calls.push(sql.includes("project-lifecycle") ? "project:lock" : sql.includes("oddpath:chat:") ? "session:lock" : "request:lock");
        return 0;
      },
      qaExecutionJob: {
        async findFirst() {
          reads += 1;
          calls.push(`read:${reads}`);
          if (reads === 1) return { requestId: "request-1" };
          return { requestId: "request-1", status: "SUCCEEDED" };
        },
        async update() { calls.push("job:update"); },
      },
      qaRequest: {
        async findUnique() { return null; },
        async update() { calls.push("request:update"); },
      },
      qaRun: {
        async update() { calls.push("run:update"); },
      },
    };
    const database = {
      async $transaction<T>(action: (transaction: typeof tx) => Promise<T>) {
        return action(tx);
      },
    } as unknown as typeof prisma;
    const repository = createQaExecutionRepository(database);

    await repository.cancel({
      actor: { kind: "USER", transport: "WEB", userId: "owner-1" },
      projectId: "project-1",
      requestId: "request-1",
      runId: "run-1",
    });

    assert.deepEqual(calls, ["read:1", "project:lock", "session:lock", "request:lock", "read:2"]);
  });

  it("does not overwrite a terminal execution found after locking a reconciliation candidate", async () => {
    const calls: string[] = [];
    let reads = 0;
    const tx = {
      async $executeRaw(strings: TemplateStringsArray) {
        const sql = strings.join("");
        calls.push(sql.includes("project-lifecycle") ? "project:lock" : sql.includes("oddpath:chat:") ? "session:lock" : "request:lock");
        return 0;
      },
      qaExecutionJob: {
        async findFirst() {
          reads += 1;
          calls.push(`read:${reads}`);
          if (reads === 1) return { id: "execution-1", requestId: "request-1" };
          if (reads === 2) {
            return {
              attempts: 3,
              deadlineAt: new Date("2026-08-30T11:59:00.000Z"),
              id: "execution-1",
              leaseExpiresAt: null,
              requestId: "request-1",
              runId: "run-1",
              status: "SUCCEEDED",
            };
          }
          return null;
        },
        async update() { calls.push("job:update"); },
        async updateMany() { calls.push("job:updateMany"); return { count: 0 }; },
      },
      qaRequest: { async findUnique() { return null; }, async update() { calls.push("request:update"); } },
      qaRun: { async update() { calls.push("run:update"); return { version: 2 }; } },
      qaRunnerRegistration: {
        async findFirst() {
          return { id: "registration-1", instanceId: "instance-1", projectId: "project-1" };
        },
      },
      qaWorkflowEvent: {
        async create() { calls.push("event:create"); },
        async findFirst() { return null; },
      },
    };
    const repository = createQaExecutionRepository(transactionalDatabase(tx), () => NOW);

    const result = await repository.claim(CLAIM_INPUT);

    assert.equal(result, null);
    assert.deepEqual(calls, ["read:1", "project:lock", "session:lock", "request:lock", "read:2", "read:3"]);
  });
});

describe("QA execution claim recovery", () => {
  for (const scenario of [
    {
      errorCode: "EXECUTION_DEADLINE_EXCEEDED",
      label: "deadline-expired queued jobs",
      job: {
        attempts: 0,
        deadlineAt: NOW,
        leaseExpiresAt: null,
        status: "QUEUED",
      },
    },
    {
      errorCode: "EXECUTION_ATTEMPTS_EXHAUSTED",
      label: "exhausted jobs after their final lease expires",
      job: {
        attempts: 3,
        deadlineAt: new Date("2026-08-30T12:10:00.000Z"),
        leaseExpiresAt: new Date("2026-08-30T11:59:59.000Z"),
        status: "RUNNING",
      },
    },
  ]) {
    it(`atomically terminalizes ${scenario.label}`, async () => {
      const jobUpdates: Array<Record<string, unknown>> = [];
      const requestUpdates: Array<Record<string, unknown>> = [];
      const runUpdates: Array<Record<string, unknown>> = [];
      const events: Array<Record<string, unknown>> = [];
      let reads = 0;
      const tx = {
        async $executeRaw() { return 0; },
        qaExecutionJob: {
          async findFirst() {
            reads += 1;
            if (reads === 1) return { id: "execution-1", requestId: "request-1" };
            if (reads === 2) {
              return {
                ...scenario.job,
                id: "execution-1",
                requestId: "request-1",
                runId: "run-1",
              };
            }
            return null;
          },
          async update(input: { data: Record<string, unknown> }) { jobUpdates.push(input.data); },
          async updateMany() { return { count: 0 }; },
        },
        qaRequest: {
          async findUnique() { return null; },
          async update(input: { data: Record<string, unknown> }) { requestUpdates.push(input.data); },
        },
        qaRun: {
          async update(input: { data: Record<string, unknown> }) {
            runUpdates.push(input.data);
            return { version: 2 };
          },
        },
        qaRunnerRegistration: {
          async findFirst() {
            return { id: "registration-1", instanceId: "instance-1", projectId: "project-1" };
          },
        },
        qaWorkflowEvent: {
          async create(input: { data: Record<string, unknown> }) { events.push(input.data); },
          async findFirst() { return null; },
        },
      };
      const repository = createQaExecutionRepository(transactionalDatabase(tx), () => NOW);

      const result = await repository.claim(CLAIM_INPUT);

      assert.equal(result, null);
      assert.equal(jobUpdates.length, 1);
      assert.equal(jobUpdates[0]?.status, "FAILED");
      assert.equal(jobUpdates[0]?.errorCode, scenario.errorCode);
      assert.equal(jobUpdates[0]?.completedAt, NOW);
      assert.equal(jobUpdates[0]?.leaseExpiresAt, null);
      assert.equal(jobUpdates[0]?.leaseTokenHash, null);
      assert.deepEqual(runUpdates, [{ status: "CANCELLED", version: { increment: 1 } }]);
      assert.deepEqual(requestUpdates, [{ phase: "READY_TO_RUN", version: { increment: 1 } }]);
      assert.equal(events[0]?.type, "EXECUTION_FAILED");
      assert.deepEqual(
        (events[0]?.metadata as Record<string, unknown>)?.errorCode,
        scenario.errorCode
      );
    });
  }

  for (const attempts of [1, 2]) {
    it(`reclaims an expired lease after attempt ${attempts} and caps the new lease at the deadline`, async () => {
      const deadlineAt = new Date("2026-08-30T12:00:20.000Z");
      let jobUpdate: { data: Record<string, unknown>; where: Record<string, unknown> } | undefined;
      let reads = 0;
      const tx = {
        async $executeRaw() { return 0; },
        qaRequest: { async findUnique() { return null; } },
        qaExecutionJob: {
          async findFirst() {
            reads += 1;
            if (reads === 1) return null;
            return {
              attempts,
              deadlineAt,
              id: "execution-1",
              requestId: "request-1",
            };
          },
          async findUnique() { return executionTaskJob(deadlineAt); },
          async updateMany(input: { data: Record<string, unknown>; where: Record<string, unknown> }) {
            jobUpdate = input;
            return { count: 1 };
          },
        },
        qaRunnerRegistration: {
          async findFirst() {
            return { id: "registration-1", instanceId: "instance-1", projectId: "project-1" };
          },
        },
        qaWorkflowEvent: {
          async create() {},
          async findFirst() { return null; },
        },
      };
      const repository = createQaExecutionRepository(transactionalDatabase(tx), () => NOW);

      const result = await repository.claim(CLAIM_INPUT) as {
        claim: { leaseExpiresAt: string };
      };

      assert.equal(result.claim.leaseExpiresAt, deadlineAt.toISOString());
      assert.deepEqual(jobUpdate?.data.attempts, { increment: 1 });
      assert.equal(jobUpdate?.data.leaseExpiresAt, deadlineAt);
      assert.deepEqual(jobUpdate?.where.attempts, { lt: 3 });
      assert.deepEqual(
        (jobUpdate?.where.OR as Array<Record<string, unknown>>)?.[1]?.status,
        { in: ["CLAIMED", "RUNNING"] }
      );
    });
  }

  it("caps heartbeat renewal at the deadline and requires the deadline to remain live", async () => {
    const deadlineAt = new Date("2026-08-30T12:00:20.000Z");
    const leaseFilters: Array<Record<string, unknown>> = [];
    let heartbeatUpdate: Record<string, unknown> | undefined;
    let reads = 0;
    const tx = {
      async $executeRaw() { return 0; },
      qaExecutionJob: {
        async findFirst(input: { where: Record<string, unknown> }) {
          leaseFilters.push(input.where);
          reads += 1;
          if (reads === 1) return { requestId: "request-1" };
          return {
            deadlineAt,
            id: "execution-1",
            leaseExpiresAt: new Date("2026-08-30T12:00:10.000Z"),
            requestId: "request-1",
            run: { version: 4 },
            runId: "run-1",
            status: "RUNNING",
          };
        },
        async updateMany(input: { data: Record<string, unknown> }) {
          heartbeatUpdate = input.data;
          return { count: 1 };
        },
      },
    };
    const repository = createQaExecutionRepository(transactionalDatabase(tx), () => NOW);

    const result = await repository.heartbeat({
      connectionTokenId: "connection-1",
      executionId: "execution-1",
      lease: { claimId: "claim-1", leaseToken: "x".repeat(43) },
      leaseExpiresAt: CLAIM_INPUT.leaseExpiresAt,
    }) as { leaseExpiresAt: string };

    assert.equal(result.leaseExpiresAt, deadlineAt.toISOString());
    assert.equal(heartbeatUpdate?.lastHeartbeatAt, NOW);
    assert.equal(heartbeatUpdate?.leaseExpiresAt, deadlineAt);
    assert.deepEqual(leaseFilters.map(({ deadlineAt: filter }) => filter), [
      { gt: NOW },
      { gt: NOW },
    ]);
  });
});

describe("QA execution immutable approval binding", () => {
  it("delivers the immutable approved profile for an unchanged registration", async () => {
    const fixture = approvalBindingFixture("claim");

    const result = await fixture.repository.claim(CLAIM_INPUT) as { task: ExecutionTaskV1 };

    assert.deepEqual(result.task.profile, fixture.job.recipe.profileManifest);
    assert.equal(result.task.profile.manifestHash, fixture.job.authorization.profileManifestHash);
    assert.deepEqual(fixture.events.map(({ type }) => type), ["EXECUTION_CLAIMED"]);
    assert.equal(fixture.jobUpdates.length, 0);
  });

  for (const initialStatus of ["QUEUED", "RUNNING"]) {
    it(`terminalizes a ${initialStatus} job instead of claiming a changed production profile`, async () => {
      const fixture = approvalBindingFixture("claim");
      fixture.job.status = initialStatus;
      fixture.job.runnerRegistration.publicProfiles = [resolveProfileManifest({
        ...fixture.job.recipe.profileManifest,
        environmentKind: "PRODUCTION",
        manifestHash: undefined,
      })];

      assert.equal(await fixture.repository.claim(CLAIM_INPUT), null);

      assert.equal(fixture.job.authorization.productionConfirmed, false);
      assertApprovalFailure(fixture, "QA_PROFILE_MANIFEST_CHANGED");
    });
  }

  it("terminalizes a job if its approved profile was removed from registration", async () => {
    const fixture = approvalBindingFixture("claim");
    fixture.job.runnerRegistration.publicProfiles = [];

    assert.equal(await fixture.repository.claim(CLAIM_INPUT), null);

    assertApprovalFailure(fixture, "QA_PROFILE_MANIFEST_CHANGED");
  });

  for (const binding of ["job", "recipe", "authorization"] as const) {
    it(`rejects a mismatched ${binding} profile hash instead of trusting current registration`, async () => {
      const fixture = approvalBindingFixture("claim");
      if (binding === "job") fixture.job.profileManifestHash = "f".repeat(64);
      else fixture.job[binding].profileManifestHash = "f".repeat(64);

      assert.equal(await fixture.repository.claim(CLAIM_INPUT), null);

      assertApprovalFailure(fixture, "QA_EXECUTION_APPROVAL_INVALID");
    });
  }

  it("rejects a corrupted immutable manifest instead of falling back to registration", async () => {
    const fixture = approvalBindingFixture("claim");
    fixture.job.recipe.profileManifest = {
      ...fixture.job.recipe.profileManifest,
      label: "Altered after approval",
    };

    assert.equal(await fixture.repository.claim(CLAIM_INPUT), null);

    assertApprovalFailure(fixture, "QA_EXECUTION_APPROVAL_INVALID");
  });

  it("rechecks registration on acceptance and commits failure before rejecting", async () => {
    const fixture = approvalBindingFixture("accept");
    fixture.job.runnerRegistration.publicProfiles = [resolveProfileManifest({
      ...fixture.job.recipe.profileManifest,
      evidenceKinds: ["SCREENSHOT"],
      manifestHash: undefined,
    })];

    await assert.rejects(fixture.repository.accept(ACCEPT_INPUT), { code: "QA_PROFILE_MANIFEST_CHANGED" });

    assert.equal(fixture.transactionCommitted(), true);
    assertApprovalFailure(fixture, "QA_PROFILE_MANIFEST_CHANGED");
    assert.equal(fixture.jobUpdates.some(({ status }) => status === "RUNNING"), false);
  });

  for (const operation of ["claim", "accept"] as const) {
    it(`requires the stored production confirmation during ${operation}`, async () => {
      const fixture = approvalBindingFixture(operation, "PRODUCTION");
      fixture.job.authorization.productionConfirmed = false;

      if (operation === "claim") {
        assert.equal(await fixture.repository.claim(CLAIM_INPUT), null);
      } else {
        await assert.rejects(fixture.repository.accept(ACCEPT_INPUT), {
          code: "QA_PRODUCTION_CONFIRMATION_REQUIRED",
        });
      }

      assertApprovalFailure(fixture, "QA_PRODUCTION_CONFIRMATION_REQUIRED");
    });
  }

  it("accepts an unchanged production profile with its exact owner confirmation", async () => {
    const fixture = approvalBindingFixture("accept", "PRODUCTION");

    const result = await fixture.repository.accept(ACCEPT_INPUT) as { status: string };

    assert.equal(result.status, "RUNNING");
    assert.deepEqual(fixture.events.map(({ type }) => type), ["EXECUTION_STARTED"]);
    assert.equal(fixture.jobUpdates[0]?.status, "RUNNING");
    assert.equal(fixture.requestUpdates.length, 0);
  });
});

const ACCEPT_INPUT = {
  actor: CLAIM_INPUT.actor,
  connectionTokenId: CLAIM_INPUT.connectionTokenId,
  executionId: "execution-1",
  lease: { claimId: "claim-1", leaseToken: CLAIM_INPUT.leaseToken },
};

function approvalBindingFixture(
  operation: "claim" | "accept",
  environmentKind: "TEST" | "PRODUCTION" = "TEST"
) {
  const job = {
    ...executionTaskJob(new Date("2026-08-30T12:10:00.000Z"), environmentKind),
    leaseExpiresAt: CLAIM_INPUT.leaseExpiresAt,
    status: "CLAIMED",
  };
  const jobUpdates: Array<Record<string, unknown>> = [];
  const runUpdates: Array<Record<string, unknown>> = [];
  const requestUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let reads = 0;
  let committed = false;
  const tx = {
    async $executeRaw() { return 0; },
    qaExecutionJob: {
      async findFirst() {
        reads += 1;
        if (operation === "claim") {
          return reads === 1 ? null : { id: job.id, requestId: job.requestId, deadlineAt: job.deadlineAt };
        }
        return reads === 1 ? { requestId: job.requestId } : job;
      },
      async findUnique() { return job; },
      async updateMany() { return { count: 1 }; },
      async update(input: { data: Record<string, unknown> }) { jobUpdates.push(input.data); },
    },
    qaRunnerRegistration: {
      async findFirst() { return { id: "registration-1", instanceId: "instance-1", projectId: "project-1" }; },
    },
    qaRun: {
      async update(input: { data: Record<string, unknown> }) {
        runUpdates.push(input.data);
        return { version: 2 };
      },
    },
    qaRequest: {
      async findUnique() { return null; },
      async update(input: { data: Record<string, unknown> }) { requestUpdates.push(input.data); },
    },
    qaWorkflowEvent: {
      async create(input: { data: Record<string, unknown> }) { events.push(input.data); },
      async findFirst() { return null; },
    },
  };
  const database = {
    async $transaction<T>(action: (transaction: typeof tx) => Promise<T>) {
      const result = await action(tx);
      committed = true;
      return result;
    },
  } as unknown as typeof prisma;
  return {
    events,
    job,
    jobUpdates,
    repository: createQaExecutionRepository(database, () => NOW),
    requestUpdates,
    runUpdates,
    transactionCommitted: () => committed,
  };
}

function assertApprovalFailure(fixture: ReturnType<typeof approvalBindingFixture>, errorCode: string) {
  assert.equal(fixture.jobUpdates.length, 1);
  assert.equal(fixture.jobUpdates[0]?.status, "FAILED");
  assert.equal(fixture.jobUpdates[0]?.errorCode, errorCode);
  assert.equal(fixture.jobUpdates[0]?.leaseExpiresAt, null);
  assert.equal(fixture.jobUpdates[0]?.leaseTokenHash, null);
  assert.deepEqual(fixture.runUpdates, [{ status: "CANCELLED", version: { increment: 1 } }]);
  assert.deepEqual(fixture.requestUpdates, [{ phase: "READY_TO_RUN", version: { increment: 1 } }]);
  assert.deepEqual(fixture.events.map(({ type }) => type), ["EXECUTION_FAILED"]);
}

function transactionalDatabase<T extends object>(tx: T) {
  return {
    async $transaction<R>(action: (transaction: T) => Promise<R>) {
      return action(tx);
    },
  } as unknown as typeof prisma;
}

function executionTaskJob(deadlineAt: Date, environmentKind: "TEST" | "PRODUCTION" = "TEST") {
  const profile = resolveProfileManifest({
    environmentKind,
    evidenceKinds: ["TEXT"],
    executorKey: "playwright",
    label: "Test profile",
    profileKey: "test.profile",
    recipeSchemaVersions: [1],
    schemaVersion: 1,
    valueReferences: [],
  });
  return {
    artifactId: "artifact-1",
    authorization: {
      artifactId: "artifact-1",
      productionConfirmed: environmentKind === "PRODUCTION",
      profileKey: profile.profileKey,
      profileManifestHash: profile.manifestHash,
      recipeHash: "a".repeat(64),
      recipeId: "recipe-1",
      runId: "run-1",
      runnerRegistrationId: "registration-1",
    },
    artifact: {
      id: "artifact-1",
      items: [{
        clientRef: null,
        evidenceRequirements: [{
          description: "Record the observed heading.",
          id: "requirement-1",
          kind: "TEXT",
          ordinal: 0,
          required: true,
        }],
        expectedResult: "The heading is visible.",
        id: "item-1",
        ordinal: 0,
        title: "Observe the heading",
      }],
      revision: 1,
      title: "Execution checklist",
    },
    deadlineAt,
    id: "execution-1",
    profileKey: profile.profileKey,
    profileManifestHash: profile.manifestHash,
    projectId: "project-1",
    recipe: {
      canonicalJson: {
        engine: "playwright",
        items: [{
          checklistItemId: "item-1",
          steps: [
            { action: "navigate", path: "/", ref: "open-page", waitUntil: "domcontentloaded" },
            {
              action: "expect",
              expectation: {
                kind: "visible",
                locator: { by: "role", name: "Checkout", role: "heading" },
              },
              ref: "see-heading",
            },
          ],
        }],
        schemaVersion: 1,
      },
      id: "recipe-1",
      profileManifest: profile,
      profileManifestHash: profile.manifestHash,
      recipeHash: "a".repeat(64),
      revision: 1,
    },
    recipeHash: "a".repeat(64),
    recipeId: "recipe-1",
    requestId: "request-1",
    run: { version: 1 },
    runId: "run-1",
    runnerRegistration: { publicProfiles: [profile] },
    runnerRegistrationId: "registration-1",
  };
}
