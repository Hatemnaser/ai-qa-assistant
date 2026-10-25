import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executionTaskSchema, executionTaskV2Schema, profileManifestSchema,
  profileManifestV2Schema, runnerRegistrationV2Schema, stopReceiptV2Schema,
  targetDefinitionSchema, targetSnapshotV2Schema,
} from "../src/index.js";

const target = targetSnapshotV2Schema.parse({ baseUrl: "https://QA.Example.com:443/app", environmentKind: "STAGING", targetId: "target-1", revisionId: "revision-1", revision: 1, targetHash: "a".repeat(64) });
const profile = profileManifestV2Schema.parse({ authentication: { kind: "NONE" }, environmentKind: "STAGING", evidenceKinds: ["TEXT"], executionLimits: { preparationTimeoutMs: 300_000, executionTimeoutMs: 600_000 }, executorKey: "playwright", label: "Staging", manifestHash: "b".repeat(64), profileKey: "staging", recipeSchemaVersions: [1], schemaVersion: 2, target, valueReferences: [] });
const task = {
  schemaVersion: 2, executionId: "execution-1", projectId: "project-1", requestId: "request-1", runId: "run-1", runVersion: 1,
  deadlineAt: "2026-10-10T12:10:00.000Z", profile,
  artifact: { id: "artifact-1", revision: 1, title: "Home", items: [{ id: "item-1", ordinal: 0, clientRef: null, title: "Home", expectedResult: "Home heading visible", evidenceRequirements: [{ id: "requirement-1", description: "Record heading", kind: "TEXT", required: true }] }] },
  recipe: { id: "recipe-1", revision: 1, hash: "c".repeat(64), bundle: { schemaVersion: 1, engine: "playwright", items: [{ checklistItemId: "item-1", steps: [{ action: "navigate", path: "/", ref: "open", waitUntil: "domcontentloaded" }, { action: "expect", ref: "see", expectation: { kind: "visible", locator: { by: "role", role: "heading", name: "Home" } } }] }] } },
  approval: { id: "approval-1", approvedAt: "2026-10-10T12:00:00.000Z", expiresAt: "2026-10-10T12:10:00.000Z", artifactId: "artifact-1", recipeId: "recipe-1", recipeHash: "c".repeat(64), profileManifestHash: profile.manifestHash, requestVersion: 3, targetRevisionId: target.revisionId, targetHash: target.targetHash, verificationId: "proof-1", bindingHash: "d".repeat(64) },
};

describe("Versioned target and execution contracts", () => {
  it('allows a bounded manual preparation budget without extending unauthenticated execution',()=>{
    const manual={...task,profile:{...profile,authentication:{kind:'MANUAL'}},deadlineAt:'2026-10-10T12:15:00.000Z',approval:{...task.approval,expiresAt:'2026-10-10T12:15:00.000Z'}};
    assert.equal(executionTaskV2Schema.safeParse(manual).success,true);
    assert.equal(executionTaskV2Schema.safeParse({...manual,profile}).success,false);
    assert.equal(executionTaskV2Schema.safeParse({...manual,approval:{...manual.approval,expiresAt:'2026-10-10T12:15:00.001Z'}}).success,false);
    assert.equal(profileManifestV2Schema.safeParse({...profile,authentication:{kind:'MANUAL',password:'secret'}}).success,false);
  });
  it("normalizes HTTPS identity and labels deployment identity as declared", () => {
    assert.equal(target.baseUrl, "https://qa.example.com/app");
    const parsed = targetDefinitionSchema.parse({ baseUrl: "https://example.com", environmentKind: "TEST", resourceOrigins: ["https://CDN.Example.com/"], candidate: { reference: "release-1", source: "DECLARED" } });
    assert.deepEqual(parsed.resourceOrigins, ["https://cdn.example.com"]);
    assert.equal(parsed.candidate?.source, "DECLARED");
    assert.equal(targetDefinitionSchema.safeParse({ ...parsed, candidate: { reference: "release-1", source: "VERIFIED" } }).success, false);
  });
  for (const baseUrl of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://user:password@example.com", "https://example.com:444", "https://example.com/?token=secret", "https://example.com/#token", "https://example.com/?", "https://example.com./", "https://example.com\\@internal.test", "https://example.com/a\nb"]) {
    it(`rejects an unsafe or ambiguous target URL: ${JSON.stringify(baseUrl)}`, () => assert.equal(targetDefinitionSchema.safeParse({ baseUrl, environmentKind: "TEST" }).success, false));
  }
  it("requires unique exact dependency origins, separate from the target", () => {
    for (const resourceOrigins of [["https://cdn.example.com/a"], ["https://cdn.example.com", "https://CDN.EXAMPLE.COM/"]]) assert.equal(targetDefinitionSchema.safeParse({ baseUrl: "https://example.com", environmentKind: "TEST", resourceOrigins }).success, false);
  });
  it("rejects wildcard and invalid DNS labels in targets and dependency origins", () => {
    for (const baseUrl of ["https://*.example.com", "https://.example.com", "https://-name.example.com", "https://under_score.example.com", `https://${"a".repeat(64)}.example.com`]) {
      assert.equal(targetDefinitionSchema.safeParse({ baseUrl, environmentKind: "TEST" }).success, false);
      assert.equal(targetDefinitionSchema.safeParse({ baseUrl: "https://example.com", environmentKind: "TEST", resourceOrigins: [baseUrl] }).success, false);
    }
  });
  it("preserves v1 parsing alongside strict v2 and rejects a v2 downgrade", () => {
    const { target: _target, authentication: _auth, executionLimits: _limits, ...legacy } = profile;
    assert.equal(profileManifestSchema.parse({ ...legacy, schemaVersion: 1 }).schemaVersion, 1);
    assert.equal(profileManifestSchema.parse(profile).schemaVersion, 2);
    assert.equal(profileManifestSchema.safeParse({ ...profile, schemaVersion: 1 }).success, false);
    assert.equal(executionTaskSchema.parse(task).schemaVersion, 2);
  });
  it("binds saved authentication to a target revision and bounds both time budgets", () => {
    for (const change of [{ environmentKind: "PRODUCTION" }, { authentication: { kind: "SAVED_STATE", id: "auth", revision: 1, targetRevisionId: "other" } }, { executionLimits: { preparationTimeoutMs: 300_001, executionTimeoutMs: 600_000 } }, { executionLimits: { preparationTimeoutMs: 300_000, executionTimeoutMs: 600_001 } }, { cookies: "private" }, { executorKey: "android" }]) assert.equal(profileManifestV2Schema.safeParse({ ...profile, ...change }).success, false);
  });
  for (const [field, value] of Object.entries({ artifactId: "other", recipeId: "other", recipeHash: "e".repeat(64), profileManifestHash: "e".repeat(64), targetRevisionId: "other", targetHash: "e".repeat(64), expiresAt: "2026-10-10T12:11:00.000Z" })) {
    it(`rejects mismatched approval ${field}`, () => assert.equal(executionTaskV2Schema.safeParse({ ...task, approval: { ...task.approval, [field]: value } }).success, false));
  }
  it("rejects expired deadline bounds and changed checklist coverage", () => {
    for (const deadlineAt of ["2026-10-10T12:00:00.000Z", "2026-10-10T12:11:00.000Z"]) assert.equal(executionTaskV2Schema.safeParse({ ...task, deadlineAt }).success, false);
    assert.equal(executionTaskV2Schema.safeParse({ ...task, artifact: { ...task.artifact, items: [] } }).success, false);
  });
  it("rejects unsupported, duplicate and legacy engine registrations on v2", () => {
    const registration = { schemaVersion: 2, displayName: "Remote", instanceId: "instance", runnerVersion: "0.2", profiles: [profile], executorKeys: ["playwright"], protocolVersions: [2] };
    assert.equal(runnerRegistrationV2Schema.safeParse(registration).success, true);
    for (const change of [{ profiles: [profile, profile] }, { executorKeys: ["playwright", "playwright"] }, { protocolVersions: [1] }, { executorKeys: ["android"] }]) assert.equal(runnerRegistrationV2Schema.safeParse({ ...registration, ...change }).success, false);
  });
});

describe("Stop receipt truthfulness", () => {
  const receipt = { executionId: "execution", runtimeId: "runtime", status: "STOP_REQUESTED", requestedAt: "2026-10-10T12:00:00.000Z", confirmedAt: null, terminationProof: null };
  it("represents requested and unconfirmed Stop without termination claims", () => {
    assert.equal(stopReceiptV2Schema.safeParse(receipt).success, true);
    assert.equal(stopReceiptV2Schema.safeParse({ ...receipt, status: "STOP_UNCONFIRMED" }).success, true);
    assert.equal(stopReceiptV2Schema.safeParse({ ...receipt, status: "STOP_CONFIRMED" }).success, false);
  });
  it("requires a runtime exit observed after request and before confirmation", () => {
    const confirmed = { ...receipt, status: "STOP_CONFIRMED", confirmedAt: "2026-10-10T12:00:02.000Z", terminationProof: { processExited: true, observedAt: "2026-10-10T12:00:01.000Z" } };
    assert.equal(stopReceiptV2Schema.safeParse(confirmed).success, true);
    assert.equal(stopReceiptV2Schema.safeParse({ ...confirmed, status: "STOP_REQUESTED" }).success, false);
    for (const observedAt of ["2026-10-10T11:59:59.000Z", "2026-10-10T12:00:03.000Z"]) assert.equal(stopReceiptV2Schema.safeParse({ ...confirmed, terminationProof: { processExited: true, observedAt } }).success, false);
    assert.equal(stopReceiptV2Schema.safeParse({ ...confirmed, terminationProof: { processExited: false, observedAt: confirmed.confirmedAt } }).success, false);
  });
});
