import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectAccessService } from "../src/modules/projects/project-access.service.ts";
import type { QaIntegrationAuth } from "../src/modules/project-connections/project-connections.middleware.ts";
import { createQaExecutionService } from "../src/modules/qa-requests/qa-execution.service.ts";
import type { QaExecutionRepository } from "../src/modules/qa-requests/qa-execution.types.ts";

const NOW = new Date("2026-08-30T12:00:00.000Z");

describe("QA execution service", () => {
  it("requires owner access and forwards the exact approved recipe/profile selection", async () => {
    const calls: string[] = [];
    let started: Parameters<QaExecutionRepository["start"]>[0] | undefined;
    const service = createQaExecutionService({
      now: () => NOW,
      projectAccess: createProjectAccess(calls),
      repository: createRepository({
        async start(input) {
          calls.push("repository:start");
          started = input;
          return { executionId: "execution-1", runId: "run-1" };
        },
      }),
    });

    const result = await service.start("owner-1", "project-1", "request-1", {
      confirmProduction: true,
      expectedRequestVersion: 7,
      profileKey: "production-checkout",
      recipeHash: "a".repeat(64),
      recipeId: "recipe-1",
      runnerRegistrationId: "registration-1",
    });

    assert.deepEqual(calls, ["access:owner-1:project-1", "repository:start"]);
    assert.deepEqual(result, { executionId: "execution-1", runId: "run-1" });
    assert.deepEqual(started, {
      actor: { kind: "USER", transport: "WEB", userId: "owner-1" },
      confirmProduction: true,
      expectedRequestVersion: 7,
      profileKey: "production-checkout",
      projectId: "project-1",
      recipeHash: "a".repeat(64),
      recipeId: "recipe-1",
      requestId: "request-1",
      runnerRegistrationId: "registration-1",
    });
  });

  it("creates a short-lived opaque lease and binds a claim to the authenticated connection", async () => {
    let claimed: Parameters<QaExecutionRepository["claim"]>[0] | undefined;
    const service = createQaExecutionService({
      now: () => NOW,
      projectAccess: createProjectAccess([]),
      randomLeaseToken: () => "x".repeat(43),
      repository: createRepository({
        async claim(input) {
          claimed = input;
          return { executionId: "execution-1" };
        },
      }),
    });

    await service.claim(auth(), { instanceId: "instance-1", registrationId: "registration-1" });

    assert.equal(claimed?.connectionTokenId, "connection-1");
    assert.equal(claimed?.leaseToken, "x".repeat(43));
    assert.equal(claimed?.leaseExpiresAt.toISOString(), "2026-08-30T12:00:45.000Z");
    assert.deepEqual(claimed?.actor, {
      connectionTokenId: "connection-1",
      kind: "INTEGRATION",
      transport: "REST",
      userId: "owner-1",
    });
  });
});

function auth(): QaIntegrationAuth {
  return {
    connectionId: "connection-1",
    ownerId: "owner-1",
    projectId: "project-1",
    scopes: ["execution:claim", "execution:write", "evidence:write", "qa:read"],
  };
}

function createRepository(
  overrides: Partial<QaExecutionRepository>
): QaExecutionRepository {
  return {
    async assertEvidenceUpload() {},
    async accept() { return {}; },
    async cancel() {},
    async claim() { return null; },
    async fail() { return {}; },
    async finish() { return {}; },
    async heartbeat() { return {}; },
    async prepareEvidenceUpload() {},
    async recordItem() { return {}; },
    async reserveEvidenceUpload() {},
    async start() { return { executionId: "execution-1", runId: "run-1" }; },
    ...overrides,
  };
}

function createProjectAccess(calls: string[]) {
  return {
    async assertProjectAccess(userId: string, projectId: string) {
      calls.push(`access:${userId}:${projectId}`);
    },
  } as unknown as ProjectAccessService;
}
