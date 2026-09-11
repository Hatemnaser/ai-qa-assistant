import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProfileManifestV1 } from "@oddpath/qa-execution-contract";

import type { ProjectAccessService } from "../src/modules/projects/project-access.service.ts";
import type { QaIntegrationAuth } from "../src/modules/project-connections/project-connections.middleware.ts";
import { hashCanonicalJson } from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import { createQaRunnerService } from "../src/modules/qa-requests/qa-runner.service.ts";
import type { QaRunnerRepository } from "../src/modules/qa-requests/qa-runner.types.ts";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const PROFILE: ProfileManifestV1 = {
  environmentKind: "TEST",
  evidenceKinds: ["TEXT", "SCREENSHOT"],
  executorKey: "playwright",
  label: "Checkout test",
  profileKey: "checkout-test",
  recipeSchemaVersions: [1],
  schemaVersion: 1,
  valueReferences: [
    { key: "checkout.email", secret: false },
    { key: "checkout.password", secret: true },
  ],
};

describe("QA runner service", () => {
  it("registers only a canonical public profile manifest", async () => {
    let storedProfiles: ProfileManifestV1[] = [];
    const service = createQaRunnerService({
      now: () => NOW,
      projectAccess: createProjectAccess([]),
      repository: {
        async listRegistrations() { return []; },
        async upsertRegistration(input) {
          storedProfiles = input.registration.profiles;
          return { id: "registration-1", lastSeenAt: NOW };
        },
      },
    });

    const receipt = await service.register(auth(), {
      displayName: "Local Playwright",
      executorKeys: ["playwright"],
      instanceId: "runner-1",
      profiles: [PROFILE],
      protocolVersions: [1],
      runnerVersion: "0.1.0",
      schemaVersion: 1,
    });

    const { manifestHash: _omitted, ...canonicalInput } = PROFILE;
    assert.equal(storedProfiles[0]?.manifestHash, hashCanonicalJson(canonicalInput));
    assert.equal(receipt.profiles[0]?.manifestHash, storedProfiles[0]?.manifestHash);
    assert.deepEqual(receipt.profiles[0]?.valueReferences, PROFILE.valueReferences);
    assert.equal(JSON.stringify(receipt).includes("checkout.password="), false);
  });

  it("classifies profiles as online, offline, or incompatible without exposing token data", async () => {
    const accessCalls: string[] = [];
    const resolvedProfile = {
      ...PROFILE,
      manifestHash: hashCanonicalJson(PROFILE),
    };
    const registrations: Awaited<ReturnType<QaRunnerRepository["listRegistrations"]>> = [
      registration("online", NOW, resolvedProfile),
      registration("offline", new Date(NOW.getTime() - 91_000), resolvedProfile),
      {
        ...registration("incompatible", NOW, resolvedProfile),
        executorKeys: [],
      },
    ];
    const service = createQaRunnerService({
      now: () => NOW,
      projectAccess: createProjectAccess(accessCalls),
      repository: {
        async listRegistrations() { return registrations; },
        async upsertRegistration() { throw new Error("not used"); },
      },
    });

    const profiles = await service.listProfiles("owner-1", "project-1");

    assert.deepEqual(profiles.map(({ status }) => status), ["ONLINE", "OFFLINE", "INCOMPATIBLE"]);
    assert.deepEqual(accessCalls, ["owner-1:project-1"]);
    assert.deepEqual(profiles[0]?.valueRefs, [
      { name: "checkout.email", secret: false },
      { name: "checkout.password", secret: true },
    ]);
    assert.equal(JSON.stringify(profiles).includes("connectionToken"), false);
  });
});

function auth(): QaIntegrationAuth {
  return {
    connectionId: "connection-1",
    ownerId: "owner-1",
    projectId: "project-1",
    scopes: ["qa:read", "execution:claim"],
  };
}

function registration(
  suffix: string,
  lastSeenAt: Date,
  profile: ProfileManifestV1
): Awaited<ReturnType<QaRunnerRepository["listRegistrations"]>>[number] {
  return {
    displayName: `Runner ${suffix}`,
    executorKeys: ["playwright"],
    id: `registration-${suffix}`,
    instanceId: `instance-${suffix}`,
    lastSeenAt,
    protocolVersions: [1],
    publicProfiles: [profile],
    runnerVersion: "0.1.0",
  };
}

function createProjectAccess(calls: string[]) {
  return {
    async assertProjectAccess(userId: string, projectId: string) {
      calls.push(`${userId}:${projectId}`);
    },
  } as unknown as ProjectAccessService;
}
