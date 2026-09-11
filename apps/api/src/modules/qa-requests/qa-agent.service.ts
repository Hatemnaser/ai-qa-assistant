import { AppError } from "../../lib/errors.js";
import { projectQaContextBuilder } from "./project-qa-context.builder.js";
import { qaProcessingRepository } from "./qa-processing.repository.js";
import type { QaProcessingRepository } from "./qa-processing.types.js";
import { qaRequestRepository } from "./qa-requests.repository.js";
import { toPublicQaRequest } from "./qa-request.dto.js";
import type {
  AddQaEvidenceCommand,
  ProjectQaContextBuilder,
  QaActor,
  QaRequestListCursor,
  QaRequestRepository,
} from "./qa-requests.types.js";
import type {
  AddQaEvidenceInput,
  CreateQaRequestInput,
  FinishQaRunInput,
  RecordQaCheckResultInput,
  StartQaRunInput,
  SubmitQaChecklistInput,
} from "./qa-requests.schema.js";

export interface QaAgentServiceDependencies {
  contextBuilder: ProjectQaContextBuilder;
  processingRepository: Pick<QaProcessingRepository, "getOperation" | "getRequestOperation">;
  repository: QaRequestRepository;
}

export function createQaAgentService({
  contextBuilder,
  processingRepository,
  repository,
}: QaAgentServiceDependencies) {
  async function createRequest(actor: QaActor, projectId: string, input: CreateQaRequestInput) {
    const snapshot = await contextBuilder.build({ projectId, userId: actor.userId, ...input });
    const requestId = await repository.createRequest({
      actor,
      projectId,
      ...input,
      checklistMode: "AGENT_PROVIDED",
      snapshot,
    });
    return {
      operation: null,
      request: toPublicQaRequest(requireRequest(await repository.getRequest(projectId, requestId))),
    };
  }

  async function listRequests(
    projectId: string,
    input: { cursor?: string; limit: number }
  ) {
    const rows = await repository.listRequests({
      cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
      limit: input.limit + 1,
      projectId,
    });
    const hasMore = rows.length > input.limit;
    const requests = rows.slice(0, input.limit).map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    }));
    const last = requests.at(-1);
    return {
      nextCursor: hasMore && last
        ? encodeCursor({ id: last.id, updatedAt: new Date(last.updatedAt) })
        : null,
      requests,
    };
  }

  async function getRequest(projectId: string, requestId: string) {
    return toPublicQaRequest(requireRequest(await repository.getRequest(projectId, requestId)));
  }

  async function getOperation(projectId: string, operationId: string) {
    return requireOperation(await processingRepository.getOperation(projectId, operationId));
  }

  async function submitChecklist(
    actor: QaActor,
    projectId: string,
    requestId: string,
    input: SubmitQaChecklistInput
  ) {
    const artifactId = await repository.submitChecklist({
      actor,
      checklist: input.checklist,
      origin: "AGENT_PROVIDED",
      projectId,
      requestId,
      supersedesArtifactId: input.supersedesArtifactId,
    });
    const [request, operation] = await Promise.all([
      repository.getRequest(projectId, requestId),
      processingRepository.getRequestOperation({
        artifactId,
        kind: "CHECKLIST_REVIEW",
        requestId,
      }),
    ]);
    return {
      artifactId,
      operation: requireOperation(operation),
      request: toPublicQaRequest(requireRequest(request)),
    };
  }

  async function startRun(actor: QaActor, projectId: string, requestId: string, input: StartQaRunInput) {
    if (input.executionMode === "PLAYWRIGHT") {
      throw new AppError(
        "Only the project owner can approve a Playwright execution.",
        403,
        "QA_EXECUTION_APPROVAL_REQUIRED"
      );
    }
    const runId = await repository.startRun({ actor, projectId, requestId, ...input });
    return { request: await getRequest(projectId, requestId), runId };
  }

  async function recordCheckResult(
    actor: QaActor,
    projectId: string,
    requestId: string,
    runId: string,
    checklistItemId: string,
    input: RecordQaCheckResultInput
  ) {
    await repository.recordCheckResult({
      actor,
      checklistItemId,
      projectId,
      requestId,
      runId,
      ...input,
    });
    return getRequest(projectId, requestId);
  }

  async function addEvidence(
    actor: QaActor,
    projectId: string,
    requestId: string,
    runId: string,
    input: AddQaEvidenceInput
  ) {
    const command: AddQaEvidenceCommand = { actor, projectId, requestId, runId, ...input };
    const evidenceId = await repository.addEvidence(command);
    return { evidenceId, request: await getRequest(projectId, requestId) };
  }

  async function finishRun(
    actor: QaActor,
    projectId: string,
    requestId: string,
    runId: string,
    input: FinishQaRunInput
  ) {
    await repository.finishRun({ actor, projectId, requestId, runId, expectedVersion: input.expectedVersion });
    return getRequest(projectId, requestId);
  }

  return {
    addEvidence,
    createRequest,
    finishRun,
    getOperation,
    getRequest,
    listRequests,
    recordCheckResult,
    startRun,
    submitChecklist,
  };
}

export const qaAgentService = createQaAgentService({
  contextBuilder: projectQaContextBuilder,
  processingRepository: qaProcessingRepository,
  repository: qaRequestRepository,
});

function requireRequest<T>(request: T | null): T {
  if (!request) throw new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
  return request;
}

function requireOperation<T>(operation: T | null): T {
  if (!operation) {
    throw new AppError("QA processing operation was not found.", 404, "QA_OPERATION_NOT_FOUND");
  }
  return operation;
}

function encodeCursor(cursor: QaRequestListCursor) {
  return Buffer.from(JSON.stringify({ id: cursor.id, updatedAt: cursor.updatedAt.toISOString() }))
    .toString("base64url");
}

function decodeCursor(value: string): QaRequestListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const updatedAt = new Date(String(parsed.updatedAt || ""));
    if (typeof parsed.id !== "string" || !parsed.id || Number.isNaN(updatedAt.getTime())) {
      throw new Error();
    }
    return { id: parsed.id, updatedAt };
  } catch {
    throw new AppError("QA request cursor is invalid.", 400, "QA_CURSOR_INVALID");
  }
}
