import { AppError } from "../../lib/errors.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { projectQaContextBuilder } from "./project-qa-context.builder.js";
import { qaProcessingRepository } from "./qa-processing.repository.js";
import type { QaProcessingRepository } from "./qa-processing.types.js";
import { qaExecutionService } from "./qa-execution.service.js";
import { qaRequestRepository } from "./qa-requests.repository.js";
import { toPublicQaRequest } from "./qa-request.dto.js";
import { getQaWorkspaceSample } from "./qa-sample.js";
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
  ReviewQaRunInput,
  StartQaRunInput,
  SubmitQaChecklistInput,
} from "./qa-requests.schema.js";

export interface QaRequestsServiceDependencies {
  contextBuilder: ProjectQaContextBuilder;
  processingRepository: Pick<QaProcessingRepository, "getOperation" | "getRequestOperation">;
  projectAccess: ProjectAccessService;
  repository: QaRequestRepository;
}

export function createQaRequestsService({
  contextBuilder,
  processingRepository,
  projectAccess,
  repository,
}: QaRequestsServiceDependencies) {
  async function listRequests(userId: string, projectId: string, input: { cursor?: string; limit: number }) {
    await projectAccess.assertProjectAccess(userId, projectId);
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

  async function getRequest(userId: string, projectId: string, requestId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return toPublicQaRequest(requireRequest(await repository.getRequest(projectId, requestId)));
  }

  async function getOperation(userId: string, projectId: string, operationId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return requireOperation(await processingRepository.getOperation(projectId, operationId));
  }

  async function createRequest(userId: string, projectId: string, input: CreateQaRequestInput) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const actor = userActor(userId);
    const snapshot = await contextBuilder.build({ projectId, userId, ...input });
    const requestId = await repository.createRequest({
      actor,
      projectId,
      ...input,
      snapshot,
    });

    const [request, operation] = await Promise.all([
      repository.getRequest(projectId, requestId),
      input.checklistMode === "ODDPATH_GENERATED"
        ? processingRepository.getRequestOperation({ kind: "CHECKLIST_GENERATION", requestId })
        : Promise.resolve(null),
    ]);
    return {
      operation: input.checklistMode === "ODDPATH_GENERATED" ? requireOperation(operation) : null,
      request: toPublicQaRequest(requireRequest(request)),
    };
  }

  async function submitChecklist(
    userId: string,
    projectId: string,
    requestId: string,
    input: SubmitQaChecklistInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const actor = userActor(userId);
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

  async function selectArtifact(
    userId: string,
    projectId: string,
    requestId: string,
    artifactId: string,
    expectedRequestVersion: number
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    await repository.selectArtifact({
      actor: userActor(userId),
      artifactId,
      expectedRequestVersion,
      projectId,
      requestId,
    });
    return getRequest(userId, projectId, requestId);
  }

  async function startRun(
    userId: string,
    projectId: string,
    requestId: string,
    input: StartQaRunInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    if (input.executionMode === "PLAYWRIGHT") {
      const execution = await qaExecutionService.start(userId, projectId, requestId, {
        confirmProduction: input.confirmProduction,
        expectedRequestVersion: input.expectedRequestVersion!,
        profileKey: input.profileKey!,
        recipeHash: input.recipeHash!,
        recipeId: input.recipeId!,
        runnerRegistrationId: input.runnerRegistrationId!,
      });
      return {
        ...execution,
        request: await getRequest(userId, projectId, requestId),
      };
    }
    const runId = await repository.startRun({
      actor: userActor(userId),
      projectId,
      requestId,
      ...input,
    });
    return { request: await getRequest(userId, projectId, requestId), runId };
  }

  async function cancelExecution(
    userId: string,
    projectId: string,
    requestId: string,
    runId: string
  ) {
    await qaExecutionService.cancel(userId, projectId, requestId, runId);
    return getRequest(userId, projectId, requestId);
  }

  async function recordCheckResult(
    userId: string,
    projectId: string,
    requestId: string,
    runId: string,
    checklistItemId: string,
    input: RecordQaCheckResultInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    await repository.recordCheckResult({
      actor: userActor(userId),
      checklistItemId,
      projectId,
      requestId,
      runId,
      ...input,
    });
    return getRequest(userId, projectId, requestId);
  }

  async function addEvidence(
    userId: string,
    projectId: string,
    requestId: string,
    runId: string,
    input: AddQaEvidenceInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const command: AddQaEvidenceCommand = {
      actor: userActor(userId),
      projectId,
      requestId,
      runId,
      ...input,
    };
    const evidenceId = await repository.addEvidence(command);
    return { evidenceId, request: await getRequest(userId, projectId, requestId) };
  }

  async function finishRun(
    userId: string,
    projectId: string,
    requestId: string,
    runId: string,
    input: FinishQaRunInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    await repository.finishRun({
      actor: userActor(userId),
      projectId,
      requestId,
      runId,
      expectedVersion: input.expectedVersion,
    });
    return getRequest(userId, projectId, requestId);
  }

  async function reviewRun(
    userId: string,
    projectId: string,
    requestId: string,
    runId: string,
    input: ReviewQaRunInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    await repository.reviewRun({
      actor: userActor(userId),
      projectId,
      requestId,
      runId,
      ...input,
    });
    return getRequest(userId, projectId, requestId);
  }

  async function getSample(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return getQaWorkspaceSample(projectId);
  }

  return {
    addEvidence,
    cancelExecution,
    createRequest,
    finishRun,
    getOperation,
    getRequest,
    getSample,
    listRequests,
    recordCheckResult,
    reviewRun,
    selectArtifact,
    startRun,
    submitChecklist,
  };
}

export const qaRequestsService = createQaRequestsService({
  contextBuilder: projectQaContextBuilder,
  processingRepository: qaProcessingRepository,
  projectAccess: projectAccessService,
  repository: qaRequestRepository,
});

function userActor(userId: string): QaActor {
  return { kind: "USER", transport: "WEB", userId };
}

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
    if (typeof parsed.id !== "string" || !parsed.id || Number.isNaN(updatedAt.getTime())) throw new Error();
    return { id: parsed.id, updatedAt };
  } catch {
    throw new AppError("QA request cursor is invalid.", 400, "QA_CURSOR_INVALID");
  }
}
