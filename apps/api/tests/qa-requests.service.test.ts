import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectAccessService } from "../src/modules/projects/project-access.service.ts";
import { createQaRequestsService } from "../src/modules/qa-requests/qa-requests.service.ts";
import type {
  ProjectQaContextBuilder,
  QaRequestRepository,
} from "../src/modules/qa-requests/qa-requests.types.ts";

const SNAPSHOT = {
  degraded: false,
  payload: { project: { memory: "Keep checkout idempotent." } },
  payloadHash: "a".repeat(64),
  retrievalMode: "LEXICAL_INDEXED",
  sourceManifest: { documents: [] },
};
const OPERATION = {
  artifactId: null,
  attempts: 0,
  availableAt: "2026-08-30T10:00:00.000Z",
  completedAt: null,
  errorCode: null,
  kind: "CHECKLIST_GENERATION" as const,
  operationId: "operation-1",
  recipeId: null,
  requestId: "request-1",
  status: "PENDING" as const,
};

describe("QA requests service", () => {
  it("persists the request and locked context before returning a durable generation receipt", async () => {
    const calls: string[] = [];
    const repository = createRepository(calls);
    const service = createQaRequestsService({
      contextBuilder: createContextBuilder(calls),
      processingRepository: createProcessingRepository(calls),
      projectAccess: createProjectAccess(calls),
      repository,
    });

    const result = await service.createRequest("user-1", "project-1", {
      checklistMode: "ODDPATH_GENERATED",
      objective: "Verify checkout",
      title: "Checkout QA",
    });

    assert.deepEqual(result, {
      operation: OPERATION,
      request: {
        executionRecipes: [],
        id: "request-1",
        operations: [],
        phase: "GENERATING",
        runs: [],
      },
    });
    assert.deepEqual(calls, [
      "access:user-1:project-1",
      "context:project-1",
      "create:ODDPATH_GENERATED:aaaaaaaa",
      "operation:CHECKLIST_GENERATION:request-1:none",
    ]);
  });

  it("returns a compatible request envelope without an operation for agent-provided mode", async () => {
    const calls: string[] = [];
    const repository = createRepository(calls);
    const service = createQaRequestsService({
      contextBuilder: createContextBuilder(calls),
      processingRepository: createProcessingRepository(calls),
      projectAccess: createProjectAccess(calls),
      repository,
    });

    const result = await service.createRequest("user-1", "project-1", {
      checklistMode: "AGENT_PROVIDED",
      objective: "Verify checkout",
      title: "Checkout QA",
    });

    assert.deepEqual(result, {
      operation: null,
      request: {
        executionRecipes: [],
        id: "request-1",
        operations: [],
        phase: "DRAFT",
        runs: [],
      },
    });
    assert.equal(calls.some((call) => call.startsWith("operation:")), false);
  });
});

function createRepository(calls: string[]) {
  let phase = "GENERATING";
  return {
    async createRequest(command) {
      calls.push(`create:${command.checklistMode}:${command.snapshot.payloadHash.slice(0, 8)}`);
      phase = command.checklistMode === "ODDPATH_GENERATED" ? "GENERATING" : "DRAFT";
      return "request-1";
    },
    async startChecklistGeneration() { calls.push("generation:start"); },
    async submitChecklist(command) {
      calls.push(`submit:${command.origin}:${command.provider}:${command.model}`);
      phase = "READY_TO_RUN";
      return "artifact-1";
    },
    async failChecklistGeneration(input) {
      calls.push(`generation:fail:${input.errorCode}`);
      phase = "PROCESSING_FAILED";
    },
    async getRequest() { return { id: "request-1", phase }; },
    async listRequests() { return []; },
    async getLatestContextSnapshot() { return SNAPSHOT; },
    async completeChecklistAssessment() {},
    async failChecklistAssessment() {},
    async addEvidence() { return "evidence-1"; },
    async finishRun() {},
    async recordCheckResult() {},
    async reviewRun() {},
    async selectArtifact() {},
    async startRun() { return "run-1"; },
  } satisfies QaRequestRepository;
}

function createContextBuilder(calls: string[]): ProjectQaContextBuilder {
  return {
    async build(input) {
      calls.push(`context:${input.projectId}`);
      return SNAPSHOT;
    },
  };
}

function createProjectAccess(calls: string[]) {
  return {
    async assertProjectAccess(userId: string, projectId: string) {
      calls.push(`access:${userId}:${projectId}`);
    },
  } as unknown as ProjectAccessService;
}

function createProcessingRepository(calls: string[]) {
  return {
    async getOperation() { return null; },
    async getRequestOperation(input: {
      artifactId?: string;
      kind: typeof OPERATION.kind;
      requestId: string;
    }) {
      calls.push(`operation:${input.kind}:${input.requestId}:${input.artifactId || "none"}`);
      return OPERATION;
    },
  };
}
