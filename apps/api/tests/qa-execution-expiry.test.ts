import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { profileManifestV2Schema, recipeBundleV1Schema, targetDefinitionSchema } from "@oddpath/qa-execution-contract";
import { prisma } from "../src/db/prisma.ts";
import { hashCanonicalJson, resolveProfileManifest } from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import { createQaExecutionRepository } from "../src/modules/qa-requests/qa-execution.repository.ts";

const NOW = new Date("2026-10-10T12:00:00.000Z");
type Operation = "accept" | "claim";
type Expiry = "proof" | "approval" | "deadline" | "lease" | "none";

function fixture(operation: Operation, expiry: Expiry, wait: "target" | "proof-read" = "target") {
  let clock = NOW.getTime(), committed = false, reads = 0;
  const events: string[] = [], updates: Array<Record<string, unknown>> = [];
  const definition = targetDefinitionSchema.parse({ baseUrl: "https://staging.example.com", environmentKind: "STAGING" });
  const revision = { id: "revision-1", targetId: "target-1", revision: 1, definition, targetHash: hashCanonicalJson(definition) };
  const executionTimeoutMs = expiry === "approval" ? 1_000 : 600_000;
  const profile = resolveProfileManifest(profileManifestV2Schema.parse({
    schemaVersion: 2, profileKey: "staging", label: "Staging", environmentKind: "STAGING",
    executorKey: "playwright", evidenceKinds: ["TEXT"], recipeSchemaVersions: [1], valueReferences: [],
    authentication: { kind: "NONE" }, executionLimits: { preparationTimeoutMs: 300_000, executionTimeoutMs },
    target: { ...definition, revision: 1, revisionId: revision.id, targetId: revision.targetId, targetHash: revision.targetHash },
  }));
  const bundle = recipeBundleV1Schema.parse({ schemaVersion: 1, engine: "playwright", items: [{ checklistItemId: "item-1", steps: [
    { action: "navigate", ref: "open", path: "/" },
    { action: "expect", ref: "see", expectation: { kind: "visible", locator: { by: "role", role: "heading", name: "Home" } } },
  ] }] });
  const recipeHash = hashCanonicalJson(bundle), expiresAt = new Date(clock + executionTimeoutMs);
  const binding = {
    id: "approval-1", approvedAt: NOW.toISOString(), expiresAt: expiresAt.toISOString(), requestVersion: 1,
    artifactId: "artifact-1", recipeId: "recipe-1", recipeHash, profileManifestHash: profile.manifestHash,
    targetRevisionId: revision.id, targetHash: revision.targetHash, verificationId: "proof-1",
    authentication: profile.authentication, executionLimits: profile.executionLimits, candidate: profile.target.candidate,
  };
  const job = {
    id: "execution-1", projectId: "project-1", requestId: "request-1", runId: "run-1", run: { version: 1 },
    artifactId: "artifact-1", recipeId: "recipe-1", recipeHash, profileKey: profile.profileKey,
    profileManifestHash: profile.manifestHash, runnerRegistrationId: "registration-1", protocolVersion: 2,
    status: operation === "claim" ? "QUEUED" : "CLAIMED",
    deadlineAt: expiry === "deadline" ? new Date(clock + 1_000) : expiresAt,
    leaseExpiresAt: new Date(clock + (expiry === "lease" ? 1_000 : 45_000)), acceptedAt: null as Date | null,
    request: { version: 2, selectedArtifactId: "artifact-1" },
    artifact: { id: "artifact-1", revision: 1, title: "Home", items: [{
      id: "item-1", ordinal: 0, clientRef: null, title: "Home", expectedResult: "Home heading visible",
      evidenceRequirements: [{ id: "evidence-1", description: "Record heading", kind: "TEXT", required: true }],
    }] },
    recipe: { id: "recipe-1", revision: 1, canonicalJson: bundle, recipeHash, profileManifest: profile, profileManifestHash: profile.manifestHash },
    runnerRegistration: { publicProfiles: [profile] },
    authorization: { ...binding, protocolVersion: 2, runId: "run-1", runnerRegistrationId: "registration-1", profileKey: profile.profileKey,
      productionConfirmed: false, approvedAt: NOW, expiresAt, binding, bindingHash: hashCanonicalJson(binding) },
  };
  const proof = { id: "proof-1", validUntil: new Date(clock + (expiry === "proof" ? 1_000 : 86_400_000)) };
  const capacity={executionId:job.id,state:operation==='claim'?'QUEUED':'ACTIVE',queueExpiresAt:expiresAt,queuedAt:NOW};
  const tx = {
    qaBrowserReservation:{
      async findUnique(){return capacity;},async findFirst(){return capacity;},
      async count(){return capacity.state==='ACTIVE'?1:0;},async updateMany(){return {count:0};},
      async update(input:{data:Record<string,unknown>}){Object.assign(capacity,input.data);return capacity;},
    },
    qaBrowserRuntime:{async count(){return 0;}},
    async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      if (wait === "target" && values.some(value => String(value).startsWith("oddpath:qa-target:"))) clock += 2_000;
      return 0;
    },
    qaExecutionJob: {
      async findFirst() { return operation === "claim" && ++reads === 1 ? null : job; },
      async findUnique() { return job; },
      async updateMany(input: { data: Record<string, unknown> }) { Object.assign(job, input.data); return { count: 1 }; },
      async update(input: { data: Record<string, unknown> }) { updates.push(input.data); Object.assign(job, input.data); return job; },
    },
    qaRunnerRegistration: { async findFirst() { return { id: "registration-1", instanceId: "instance-1", projectId: "project-1" }; } },
    qaTarget: { async findFirst() { return { id: revision.targetId, currentRevision: 1 }; } },
    qaTargetRevision: { async findFirst() { return revision; } },
    qaTargetVerification: { async findFirst(input: { where: { validUntil: { gt: Date } } }) {
      const result = proof.validUntil > input.where.validUntil.gt ? proof : null;
      if (wait === "proof-read") clock += 2_000;
      return result;
    } },
    qaRequest: { async findUnique() { return null; }, async update() {} },
    qaRun: { async update() { return { version: 2 }; } },
    qaWorkflowEvent: { async findFirst() { return null; }, async create(input: { data: { type: string } }) { events.push(input.data.type); } },
  };
  const database = { async $transaction<T>(action: (transaction: typeof tx) => Promise<T>) {
    const result = await action(tx); committed = true; return result;
  } } as unknown as typeof prisma;
  const repository = createQaExecutionRepository(database, () => new Date(clock), { allowV2: true });
  const actor = { kind: "INTEGRATION" as const, transport: "REST" as const, userId: "owner-1" };
  const invoke = () => operation === "accept"
    ? repository.accept({ actor, connectionTokenId: "connection-1", executionId: job.id, lease: { claimId: "claim-1", leaseToken: "x".repeat(43) } })
    : repository.claim({ actor, connectionTokenId: "connection-1", protocolVersion: 2,
      request: { instanceId: "instance-1", registrationId: "registration-1" }, leaseToken: "x".repeat(43), leaseExpiresAt: new Date(NOW.getTime() + 45_000) });
  return { invoke, job, events, updates, committed: () => committed };
}

describe("V2 expiration after waiting for authorization locks", () => {
  for (const operation of ["accept", "claim"] as const) {
    for (const expiry of ["proof", "approval", "deadline"] as const) {
      it(`rejects ${expiry} expiry during ${operation}'s target lock and commits the failure`, async () => {
        const f = fixture(operation, expiry);
        const code = expiry === "proof" ? "QA_TARGET_VERIFICATION_REQUIRED" : "QA_EXECUTION_APPROVAL_INVALID";
        if (operation === "accept") await assert.rejects(f.invoke, { code });
        else assert.equal(await f.invoke(), null);
        assert.equal(f.committed(), true);
        assert.equal(f.job.status, "FAILED");
        assert.equal(f.updates.at(-1)?.errorCode, code);
        assert.equal(f.job.acceptedAt, null);
        assert.deepEqual(f.events, ["EXECUTION_FAILED"]);
      });
    }
    it(`rejects proof expiry during ${operation}'s database read`, async () => {
      const f = fixture(operation, "proof", "proof-read");
      if (operation === "accept") await assert.rejects(f.invoke, { code: "QA_TARGET_VERIFICATION_REQUIRED" });
      else assert.equal(await f.invoke(), null);
      assert.equal(f.committed(), true);
      assert.deepEqual(f.events, ["EXECUTION_FAILED"]);
    });
    it(`preserves valid ${operation} after waiting for the target lock`, async () => {
      const f = fixture(operation, "none");
      const result = await f.invoke();
      assert.ok(result);
      assert.equal(f.committed(), true);
      assert.equal(f.updates.some(update => update.status === "FAILED"), false);
      assert.deepEqual(f.events, [operation === "accept" ? "EXECUTION_STARTED" : "EXECUTION_CLAIMED"]);
      if (operation === "accept") assert.equal(f.job.acceptedAt?.getTime(), NOW.getTime() + 2_000);
    });
  }
  it("does not grant acceptance when the lease expires during the target lock", async () => {
    const f = fixture("accept", "lease");
    await assert.rejects(f.invoke, { code: "QA_EXECUTION_LEASE_LOST" });
    assert.equal(f.committed(), false);
    assert.equal(f.job.acceptedAt, null);
    assert.equal(f.events.includes("EXECUTION_STARTED"), false);
  });
});
