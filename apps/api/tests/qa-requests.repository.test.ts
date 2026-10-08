import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { prisma } from "../src/db/prisma.ts";
import { createPrismaQaRequestRepository } from "../src/modules/qa-requests/qa-requests.repository.ts";
import type {
  QaActor,
  QaRequestPhase,
  QaRunStatus,
} from "../src/modules/qa-requests/qa-requests.types.ts";

const ACTORS: QaActor[] = [
  { kind: "INTEGRATION", transport: "REST", userId: "owner-1", connectionTokenId: "agent-1" },
  { kind: "INTEGRATION", transport: "MCP", userId: "owner-1", connectionTokenId: "agent-1" },
  { kind: "USER", transport: "WEB", userId: "owner-1" },
];
const RUN_INPUT = { projectId: "project-1", requestId: "request-1", runId: "run-1" };

describe("QA request repository execution protocol boundary", () => {
  for (const actor of ACTORS) {
    for (const status of ["CREATED", "ACTIVE"] as const) {
      for (const operation of ["result", "evidence", "finish"] as const) {
        it(`rejects generic ${actor.transport} ${operation} writes to ${status} execution-bound runs`, async () => {
          const fixture = createFixture({ executionRecipeId: "recipe-1", status });
          const action = operation === "result"
            ? () => fixture.repository.recordCheckResult({
                ...RUN_INPUT,
                actor,
                checklistItemId: "item-1",
                expectedVersion: 1,
                status: "PASS",
              })
            : operation === "finish"
              ? () => fixture.repository.finishRun({ ...RUN_INPUT, actor, expectedVersion: 1 })
              : () => fixture.repository.addEvidence({
                  ...RUN_INPUT,
                  actor,
                  assetIds: ["asset-1"],
                  checklistItemId: "item-1",
                  kind: "TEXT",
                  requirementId: "requirement-1",
                  textContent: "Unassigned actor evidence",
                });

          await assert.rejects(action, {
            code: "QA_EXECUTION_PROTOCOL_REQUIRED",
            statusCode: 409,
          });
          assert.deepEqual(fixture.calls, ["project:lock", "session:lock", "request:lock", "request:read", "run:read"]);
          assert.equal(fixture.run.version, 1);
          assert.equal(fixture.run.status, status);
          assert.equal(fixture.request.version, 1);
          assert.equal(fixture.request.phase, "RUNNING");
          assert.deepEqual(fixture.results, []);
          assert.deepEqual(fixture.evidence, []);
          assert.deepEqual(fixture.events, []);
        });
      }
    }

    it(`preserves the ordinary ${actor.transport} result, evidence, and finish lifecycle`, async () => {
      const fixture = createFixture();
      await fixture.repository.recordCheckResult({
        ...RUN_INPUT,
        actor,
        checklistItemId: "item-1",
        expectedVersion: 1,
        status: "PASS",
      });
      await fixture.repository.addEvidence({
        ...RUN_INPUT,
        actor,
        assetIds: [],
        checklistItemId: "item-1",
        kind: "TEXT",
        requirementId: "requirement-1",
        textContent: "Observed ordinary run evidence",
      });
      await fixture.repository.finishRun({ ...RUN_INPUT, actor, expectedVersion: fixture.run.version });

      assert.equal(fixture.run.status, "RESULTS_SUBMITTED");
      assert.equal(fixture.run.version, 4);
      assert.equal(fixture.request.phase, "READY_FOR_REVIEW");
      assert.equal(fixture.evidence.length, 1);
      assert.deepEqual(fixture.events, ["CHECK_RESULT_RECORDED", "EVIDENCE_ADDED", "RUN_RESULTS_SUBMITTED"]);
    });

    it(`preserves ${actor.transport} evidence supplementation after execution submission`, async () => {
      const fixture = createFixture({
        executionRecipeId: "recipe-1",
        phase: "EVIDENCE_NEEDED",
        status: "RESULTS_SUBMITTED",
      });
      await fixture.repository.addEvidence({
        ...RUN_INPUT,
        actor,
        assetIds: [],
        checklistItemId: "item-1",
        kind: "TEXT",
        requirementId: "requirement-1",
        textContent: "Supplemental submitted-run proof",
      });

      assert.equal(fixture.run.status, "RESULTS_SUBMITTED");
      assert.equal(fixture.run.version, 2);
      assert.equal(fixture.request.phase, "READY_FOR_REVIEW");
      assert.equal(fixture.evidence.length, 1);
      assert.deepEqual(fixture.events, ["EVIDENCE_ADDED"]);
    });
  }
});

function createFixture(input: {
  executionRecipeId?: string | null;
  phase?: QaRequestPhase;
  status?: QaRunStatus;
} = {}) {
  const calls: string[] = [];
  const events: string[] = [];
  const results: Array<{ status: string }> = [];
  const evidence: Array<{ id: string; requirementId: string | null }> = [];
  const request = {
    id: "request-1",
    phase: input.phase ?? "RUNNING",
    projectId: "project-1",
    selectedArtifactId: "artifact-1",
    version: 1,
  };
  const run = {
    artifactId: "artifact-1",
    executionRecipeId: input.executionRecipeId ?? null,
    id: "run-1",
    requestId: request.id,
    status: input.status ?? "ACTIVE",
    version: 1,
  };
  const tx = {
    async $executeRaw(strings: TemplateStringsArray) {
      const sql = strings.join("");
      calls.push(sql.includes("project-lifecycle") ? "project:lock" : sql.includes("oddpath:chat:") ? "session:lock" : "request:lock");
      return 0;
    },
    qaRequest: {
      async findUnique() { return request; },
      async findFirst() { calls.push("request:read"); return request; },
      async update({ data }: { data: { phase?: QaRequestPhase; version?: { increment: number } } }) {
        calls.push("request:update");
        if (data.phase) request.phase = data.phase;
        if (data.version) request.version += data.version.increment;
        return request;
      },
    },
    qaRun: {
      async findFirst() { calls.push("run:read"); return run; },
      async update({ data }: { data: { status?: QaRunStatus; version?: { increment: number } } }) {
        calls.push("run:update");
        if (data.status) run.status = data.status;
        if (data.version) run.version += data.version.increment;
        return run;
      },
    },
    qaChecklistItem: {
      async findFirst() { calls.push("item:read"); return { id: "item-1" }; },
      async count() { calls.push("items:count"); return 1; },
    },
    qaCheckResult: {
      async upsert({ create }: { create: { status: string } }) {
        calls.push("result:write");
        results.splice(0, results.length, { status: create.status });
      },
      async findMany() { calls.push("results:read"); return results; },
    },
    qaEvidenceRequirement: {
      async findFirst() {
        calls.push("requirement:read");
        return { checklistItemId: "item-1", kind: "TEXT" };
      },
      async findMany() { calls.push("requirements:read"); return [{ id: "requirement-1" }]; },
    },
    qaEvidence: {
      async count() { calls.push("evidence:count"); return evidence.length; },
      async create({ data }: { data: { requirementId: string | null } }) {
        calls.push("evidence:write");
        const entry = { id: `evidence-${evidence.length + 1}`, requirementId: data.requirementId };
        evidence.push(entry);
        return entry;
      },
      async findMany() { calls.push("evidence:read"); return evidence; },
    },
    storedAsset: {
      async findMany() { calls.push("assets:read"); return []; },
    },
    qaWorkflowEvent: {
      async findFirst() { calls.push("history:read"); return { sequence: events.length }; },
      async create({ data }: { data: { type: string } }) {
        calls.push("history:write");
        events.push(data.type);
      },
    },
  };
  const database = {
    async $transaction<T>(action: (transaction: typeof tx) => Promise<T>) { return action(tx); },
  } as unknown as typeof prisma;
  return {
    calls,
    evidence,
    events,
    repository: createPrismaQaRequestRepository(database),
    request,
    results,
    run,
  };
}
