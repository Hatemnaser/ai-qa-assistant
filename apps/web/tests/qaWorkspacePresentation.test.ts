import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  qaChecklistEvidence,
  qaGeneralEvidence,
  qaWorkspaceNextAction,
  type QaWorkspaceNextActionInput,
} from "../src/features/qa/workspacePresentation.ts";
import type {
  QaArtifact, QaCheckResult, QaEvidence, QaExecutionJob, QaExecutionRecipe,
  QaRequestDetail, QaRun,
} from "../src/features/qa/types.ts";

const now = "2026-09-20T10:00:00.000Z";

describe("QA Workspace next action", () => {
  it("suppresses actions while loading or mutating even with an old actionable request", () => {
    for (const input of [
      state({ isLoading: true, isBusy: true }),
      state({ isBusy: true }),
    ]) {
      const next = qaWorkspaceNextAction(input);
      assert.equal(next.action, null);
      assert.equal(next.actionKey, null);
      assert.equal(next.disabled, true);
    }
    expectState(state({ isLoading: true, isBusy: true }), "loading", null);
    expectState(state({ isBusy: true }), "busy", null);
  });

  it("offers a real creation action for empty/sample states without executing the sample", () => {
    expectState(state({ request: null }), "empty", "create");
    expectState(state({ isSample: true }), "sample", "create");
    expectState(state({ request: request({ sample: true, phase: "APPROVED" }) }), "sample", "create");
  });

  it("offers explicit read recovery instead of setup/creation against absent or stale data", () => {
    expectState(state({ request: null, artifact: null, loadError: true }), "loadFailed", "refresh");
    expectState(state({ loadError: true }), "loadFailed", "refresh");
    expectState(state({ isSample: true, loadError: true }), "loadFailed", "refresh");
    expectState(state({ isLoading: true, loadError: true }), "loading", null);
    expectState(state({ isBusy: true, loadError: true }), "busy", null);
    expectState(state({ loadError: false }), "preparing", "prepare");
  });

  it("keeps checklist generation and failed generation distinct without inventing retry", () => {
    expectState(state({ request: request({ phase: "GENERATING" }), artifact: null, canStartRun: false }), "generating", null);
    expectState(state({ request: request({ phase: "PROCESSING_FAILED" }), artifact: null, canStartRun: false }), "generationFailed", "create");
    for (const status of ["PENDING", "PROCESSING"] as const) {
      expectState(state({
        request: request({ phase: "DRAFT", operations: [{ operationId: "generation", requestId: "request", kind: "CHECKLIST_GENERATION", status }] }),
        artifact: null, canStartRun: false,
      }), "generating", null);
    }
  });

  it("offers connections for a draft awaiting an agent checklist, not automatic delegation", () => {
    expectState(state({ request: request({ phase: "DRAFT" }), artifact: null, canStartRun: false }), "awaitingChecklist", "connect");
  });

  it("does not let stale pending operations from another request block a draft", () => {
    expectState(state({
      request: request({ phase: "DRAFT", operations: [{ operationId: "unrelated", requestId: "another", kind: "CHECKLIST_GENERATION", status: "PENDING" }] }),
      artifact: null, canStartRun: false,
    }), "awaitingChecklist", "connect");
  });

  it("allows owner selection after failed advisory assessment, but never while pending", () => {
    for (const status of ["PASSED", "SUGGESTIONS", "FAILED", "PENDING"] as const) {
      const checklist = artifact();
      checklist.origin = "AGENT_PROVIDED";
      checklist.assessments = [{ id: "assessment", status, summary: null, suggestions: [], createdAt: now, completedAt: null }];
      expectState(state({
        request: request({ phase: "CHECKLIST_REVIEW", selectedArtifactId: null }),
        artifact: checklist, canSelectArtifact: status !== "PENDING", canStartRun: false,
      }), status === "PENDING" ? "reviewingChecklist" : status === "FAILED" ? "checklistReviewFailed" : "checklistReady",
      status === "PENDING" ? null : "select");
    }
  });

  it("uses the actual checklist target when recognizing a pending review receipt", () => {
    const checklist = artifact();
    for (const artifactId of [checklist.id, "other-artifact"]) {
      expectState(state({
        request: request({ phase: "CHECKLIST_REVIEW", selectedArtifactId: null, operations: [{ operationId: "review", requestId: "request", artifactId, kind: "CHECKLIST_REVIEW", status: "PROCESSING" }] }),
        artifact: checklist, canSelectArtifact: false, canStartRun: false,
      }), artifactId === checklist.id ? "reviewingChecklist" : "unavailable", artifactId === checklist.id ? null : "refresh");
    }
  });

  it("does not grant checklist selection from a passed assessment without the existing gate", () => {
    const checklist = artifact();
    checklist.assessments = [{ id: "assessment", status: "PASSED", summary: null, suggestions: [], createdAt: now, completedAt: now }];
    expectState(state({
      request: request({ phase: "CHECKLIST_REVIEW", selectedArtifactId: null }), artifact: checklist,
      canSelectArtifact: false, canStartRun: false,
    }), "unavailable", "refresh");
  });

  it("keeps preparation generic for generated checklists and every latest Recipe review status", () => {
    for (const status of [null, "PENDING", "FAILED", "PASSED", "SUGGESTIONS"] as const) {
      const recipes = status ? [recipe(status), { ...recipe("PASSED"), id: "older-valid", revision: 1 }] : [];
      expectState(state({ request: request({ executionRecipes: recipes }) }), "preparing", "prepare");
    }
    // Profile presence/online/compatibility and the exact selected Recipe are
    // run-dialog concerns; this helper has no profile-derived execution gate.
    assert.equal("runnerProfiles" in state(), false);
  });

  it("never lets recipe review receipts become checklist-review blockers", () => {
    expectState(state({ request: request({ operations: [{ operationId: "recipe-review", requestId: "request", artifactId: "artifact", recipeId: "recipe", kind: "EXECUTION_RECIPE_REVIEW", status: "PENDING" }] }) }), "preparing", "prepare");
  });

  it("shows active Playwright execution without another setup action", () => {
    for (const status of ["QUEUED", "CLAIMED", "RUNNING"] as const) {
      expectState(state({ request: request({ phase: "RUNNING" }), run: run({ status: "ACTIVE", executionMode: "PLAYWRIGHT", executionJob: job(status) }) }), "running", null);
    }
    expectState(state({ run: run({ status: "CREATED", executionMode: "PLAYWRIGHT" }) }), "running", null);
  });

  it("retains explicit refresh for connected-agent work and legacy active runs", () => {
    for (const executionMode of [undefined, null, "CONNECTED_AGENT"] as const) {
      expectState(state({ run: run({ status: "ACTIVE", executionMode }), canStartRun: false }), "externalRunning", "refresh");
    }
  });

  it("uses the domain rerun gate after cancellation/failure, preserving partial evidence", () => {
    for (const status of ["FAILED", "CANCELLED"] as const) {
      for (const canStartRun of [true, false]) {
        expectState(state({
          request: request({ phase: canStartRun ? "READY_TO_RUN" : "CANCELLED" }),
          run: run({ status: "CANCELLED", executionMode: "PLAYWRIGHT", executionJob: job(status) }),
          missingEvidenceCount: 5, canStartRun,
        }), status === "FAILED" ? "executionFailed" : "executionCancelled", canStartRun ? "prepare" : null);
      }
    }
  });

  it("offers preparation for requested changes only when the current run gate allows it", () => {
    expectState(state({ request: request({ phase: "CHANGES_REQUESTED" }), run: run() }), "changesRequested", "prepare");
    expectState(state({ request: request({ phase: "CHANGES_REQUESTED" }), run: run(), canStartRun: false }), "results", "results");
  });

  it("surfaces missing exact evidence before human review, without pretending to upload it", () => {
    expectState(state({ request: request({ phase: "EVIDENCE_NEEDED" }), run: run(), canStartRun: false, missingEvidenceCount: 1, canReview: true }), "evidence", "evidence");
    expectState(state({ run: null, canStartRun: false, missingEvidenceCount: 1 }), "unavailable", "refresh");
  });

  it("requires the existing review gate, not merely a successful execution or complete evidence", () => {
    const finished = run({ executionMode: "PLAYWRIGHT", executionJob: job("SUCCEEDED") });
    expectState(state({ request: request({ phase: "READY_FOR_REVIEW" }), run: finished, canStartRun: false, canReview: true }), "review", "review");
    expectState(state({ run: finished, canStartRun: false, canReview: false }), "results", "results");
  });

  it("keeps approved records inspectable without implying a new run or release approval", () => {
    const presentation = qaWorkspaceNextAction(state({ request: request({ phase: "APPROVED" }), run: run(), canReview: true }));
    assert.equal(presentation.titleKey, "projects.qa.focus.next.approvedTitle");
    assert.equal(presentation.action, "results");
    assert.equal(presentation.tone, "success");
  });

  it("does not fabricate Runner/setup state when detail data is unavailable or inconsistent", () => {
    expectState(state({ request: request({ phase: "RUNNING" }), artifact: null, run: null, canStartRun: false }), "unavailable", "refresh");
  });
});

describe("QA Workspace evidence presentation", () => {
  it("does not claim missing run evidence before execution or pair another artifact's results", () => {
    assert.deepEqual(qaChecklistEvidence(null, null), []);
    const checklist = artifact();
    const rows = qaChecklistEvidence(checklist, null);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(({ result, evidence, missingRequirements }) => ({ result, evidence, missingRequirements })), [
      { result: null, evidence: [], missingRequirements: [] }, { result: null, evidence: [], missingRequirements: [] },
    ]);
    const unrelated = run({ artifactId: "other-artifact", results: [result()], evidence: [evidence()] });
    assert.deepEqual(qaChecklistEvidence(checklist, unrelated), rows);
    assert.deepEqual(qaGeneralEvidence(checklist, unrelated), unrelated.evidence);
  });

  it("groups requirement-only evidence with its item and shows stored result values unchanged", () => {
    const proof = evidence({ checklistItemId: null, requirementId: "requirement-1" });
    const check = result({ observedResult: "Actually observed text", notes: "Diagnostic note", status: "FAIL" });
    const rows = qaChecklistEvidence(artifact(), run({ results: [check], evidence: [proof] }));
    assert.equal(rows[0]!.result, check);
    assert.deepEqual(rows[0]!.evidence, [proof]);
    assert.deepEqual(rows[0]!.missingRequirements, []);
    assert.equal(rows[1]!.missingRequirements[0]!.id, "requirement-2");
    assert.deepEqual(qaGeneralEvidence(artifact(), run({ evidence: [proof] })), []);
  });

  it("counts only exact requirement IDs, never the item association or similar text", () => {
    const checklist = artifact();
    const proofs = [evidence({ requirementId: null }), evidence({ id: "unknown", requirementId: "not-the-requirement" })];
    const rows = qaChecklistEvidence(checklist, run({ evidence: proofs }));
    assert.deepEqual(rows[0]!.evidence, proofs);
    assert.deepEqual(rows[0]!.missingRequirements.map(({ id }) => id), ["requirement-1"]);
    assert.deepEqual(rows[1]!.missingRequirements.map(({ id }) => id), ["requirement-2"]);
    assert.equal(rows.flatMap(({ missingRequirements }) => missingRequirements).length, 2);
  });

  it("routes known requirement identity before item identity without duplicating or dropping proof", () => {
    const proof = evidence({ checklistItemId: "item-2", requirementId: "requirement-1" });
    const rows = qaChecklistEvidence(artifact(), run({ evidence: [proof] }));
    assert.deepEqual(rows[0]!.evidence, [proof]);
    assert.deepEqual(rows[1]!.evidence, []);
    assert.deepEqual(rows[0]!.missingRequirements, []);
    assert.equal(rows[1]!.missingRequirements.length, 1);
    assert.equal(proof.checklistItemId, "item-2");
  });

  it("retains general, unknown-item, and unknown-requirement proof in the general section", () => {
    const proofs = [
      evidence({ id: "general", checklistItemId: null, requirementId: null }),
      evidence({ id: "unknown-item", checklistItemId: "unknown", requirementId: null }),
      evidence({ id: "unknown-requirement", checklistItemId: null, requirementId: "unknown" }),
      evidence({ id: "item", requirementId: null }),
      evidence({ id: "requirement", checklistItemId: null }),
    ];
    const currentRun = run({ evidence: proofs });
    const rows = qaChecklistEvidence(artifact(), currentRun);
    const general = qaGeneralEvidence(artifact(), currentRun);
    assert.deepEqual(general.map(({ id }) => id), ["general", "unknown-item", "unknown-requirement"]);
    assert.deepEqual(rows[0]!.evidence.map(({ id }) => id), ["item", "requirement"]);
    assert.deepEqual([...rows.flatMap(({ evidence }) => evidence), ...general].map(({ id }) => id).sort(), proofs.map(({ id }) => id).sort());
    assert.deepEqual(qaGeneralEvidence(null, currentRun), proofs);
    assert.deepEqual(qaGeneralEvidence(artifact(), null), []);
  });

  it("does not require optional evidence or mutate input arrays while grouping", () => {
    const checklist = artifact();
    const currentRun = run({ evidence: [evidence(), evidence({ id: "second-proof" })] });
    const before = JSON.stringify({ checklist, currentRun });
    const rows = qaChecklistEvidence(checklist, currentRun);
    qaGeneralEvidence(checklist, currentRun);
    assert.equal(rows[0]!.evidence.length, 2);
    assert.deepEqual(rows.flatMap(({ missingRequirements }) => missingRequirements).map(({ id }) => id), ["requirement-2"]);
    assert.equal(JSON.stringify({ checklist, currentRun }), before);
  });
});

function expectState(input: QaWorkspaceNextActionInput, name: string, action: ReturnType<typeof qaWorkspaceNextAction>["action"]) {
  const next = qaWorkspaceNextAction(input);
  assert.equal(next.titleKey, `projects.qa.focus.next.${name}Title`);
  assert.equal(next.messageKey, `projects.qa.focus.next.${name}Body`);
  assert.equal(next.action, action);
  assert.equal(next.actionKey, action ? `projects.qa.focus.actions.${action}` : null);
}

function state(overrides: Partial<QaWorkspaceNextActionInput> = {}): QaWorkspaceNextActionInput {
  return { request: request(), artifact: artifact(), run: null, isLoading: false, isSample: false, canSelectArtifact: false, canStartRun: true, canReview: false, missingEvidenceCount: 0, isBusy: false, ...overrides };
}

function request(overrides: Partial<QaRequestDetail> = {}): QaRequestDetail {
  return {
    id: "request", projectId: "project", title: "Login", objective: "Verify login", phase: "READY_TO_RUN", version: 1,
    createdAt: now, updatedAt: now, target: "/login", environment: "Test", acceptanceNotes: null,
    selectedArtifactId: "artifact", contextSnapshots: [], artifacts: [artifact()], runs: [], reviews: [], events: [], ...overrides,
  };
}

function artifact(): QaArtifact {
  return {
    id: "artifact", requestId: "request", revision: 1, origin: "ODDPATH_GENERATED", title: "Login checks", lockedAt: null, createdAt: now, assessments: [],
    items: [1, 2].map((number) => ({
      id: `item-${number}`, artifactId: "artifact", ordinal: number, clientRef: null, title: `Check ${number}`, category: null, priority: null,
      preconditions: [], steps: [], expectedResult: "Visible", createdAt: now,
      evidenceRequirements: [
        { id: `requirement-${number}`, checklistItemId: `item-${number}`, ordinal: 0, kind: "TEXT", description: "Observed state", required: true, createdAt: now },
        { id: `optional-${number}`, checklistItemId: `item-${number}`, ordinal: 1, kind: "SCREENSHOT", description: "Optional screenshot", required: false, createdAt: now },
      ],
    })),
  };
}

function run(overrides: Partial<QaRun> = {}): QaRun {
  return {
    id: "run", requestId: "request", artifactId: "artifact", status: "RESULTS_SUBMITTED", outcome: "PASS", version: 1,
    sourceLabel: "Runner", externalRunRef: null, commitSha: null, startedAt: now, submittedAt: now, createdAt: now, updatedAt: now,
    results: [], evidence: [], ...overrides,
  };
}

function result(overrides: Partial<QaCheckResult> = {}): QaCheckResult {
  return { id: "result", runId: "run", checklistItemId: "item-1", status: "PASS", observedResult: null, notes: null, createdAt: now, updatedAt: now, ...overrides };
}

function evidence(overrides: Partial<QaEvidence> = {}): QaEvidence {
  return {
    id: "evidence", runId: "run", checklistItemId: "item-1", requirementId: "requirement-1", actorKind: "INTEGRATION", transport: "REST",
    kind: "TEXT", textContent: "Observed state", externalReference: null, metadata: null, createdAt: now, assets: [], ...overrides,
  };
}

function job(status: QaExecutionJob["status"]): QaExecutionJob {
  return { id: "job", runId: "run", recipeId: "recipe", runnerRegistrationId: "runner", profileKey: "local", status, completedItems: 0, totalItems: 2, failureCode: null, failureMessage: null, createdAt: now, updatedAt: now };
}

function recipe(status: "PASSED" | "PENDING" | "FAILED" | "SUGGESTIONS"): QaExecutionRecipe {
  return {
    id: "recipe", requestId: "request", artifactId: "artifact", revision: 2, origin: "ODDPATH_GENERATED", title: "Recipe", schemaVersion: 1, executorKey: "playwright",
    recipeHash: "a".repeat(64), bundle: { schemaVersion: 1, engine: "playwright", items: [] }, profileManifest: null, profileManifestHash: null, supersedesRecipeId: null, items: [],
    assessments: [{ id: "review", status, summary: null, suggestions: [], createdAt: now, completedAt: null }], createdAt: now,
  };
}
