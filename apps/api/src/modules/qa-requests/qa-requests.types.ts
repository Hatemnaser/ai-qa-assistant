export type QaRequestPhase =
  | "DRAFT"
  | "GENERATING"
  | "CHECKLIST_REVIEW"
  | "READY_TO_RUN"
  | "RUNNING"
  | "EVIDENCE_NEEDED"
  | "READY_FOR_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PROCESSING_FAILED"
  | "CANCELLED";

export type QaArtifactOrigin = "ODDPATH_GENERATED" | "AGENT_PROVIDED";
export type QaChecklistAssessmentStatus = "PENDING" | "PASSED" | "SUGGESTIONS" | "FAILED";
export type QaRunStatus = "CREATED" | "ACTIVE" | "RESULTS_SUBMITTED" | "CANCELLED";
export type QaRunOutcome = "NOT_RUN" | "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
export type QaCheckResultStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type QaEvidenceKind = "TEXT" | "SCREENSHOT" | "LOG" | "TRACE" | "FILE" | "REFERENCE";
export type QaReviewDecision = "APPROVED" | "CHANGES_REQUESTED";
export type QaActorKind = "USER" | "INTEGRATION" | "SYSTEM";
export type QaTransport = "WEB" | "REST" | "MCP" | "SYSTEM";

export interface QaActor {
  kind: QaActorKind;
  transport: QaTransport;
  userId?: string;
  connectionTokenId?: string;
}

export interface QaEvidenceRequirementDraft {
  kind: QaEvidenceKind;
  description: string;
  required?: boolean;
}

export interface QaChecklistItemDraft {
  clientRef?: string;
  title: string;
  category?: string;
  priority?: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  evidenceRequirements: QaEvidenceRequirementDraft[];
}

export interface QaChecklistDraft {
  title: string;
  items: QaChecklistItemDraft[];
}

export interface QaContextSnapshotInput {
  payload: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  payloadHash: string;
  retrievalMode: string;
  degraded: boolean;
}

export interface CreateQaRequestCommand {
  actor: QaActor;
  projectId: string;
  title: string;
  objective: string;
  target?: string;
  environment?: string;
  acceptanceNotes?: string;
  checklistMode: QaArtifactOrigin;
  snapshot: QaContextSnapshotInput;
  idempotencyKeyHash?: string;
  testSessionId?: string;
}

export interface SubmitQaChecklistCommand {
  actor: QaActor;
  projectId: string;
  requestId: string;
  origin: QaArtifactOrigin;
  checklist: QaChecklistDraft;
  supersedesArtifactId?: string;
  provider?: string;
  model?: string;
  processing?: QaProcessingLease;
}

export interface QaProcessingLease {
  executionId: string;
  leaseToken: string;
}

export interface AddQaEvidenceCommand {
  actor: QaActor;
  projectId: string;
  requestId: string;
  runId: string;
  checklistItemId?: string;
  requirementId?: string;
  kind: QaEvidenceKind;
  textContent?: string;
  externalReference?: string;
  assetIds: string[];
  metadata?: Record<string, unknown>;
}

export interface QaRequestListCursor {
  updatedAt: Date;
  id: string;
}

export interface QaRequestListItem {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  phase: QaRequestPhase;
  version: number;
  updatedAt: Date;
  createdAt: Date;
}

export interface QaRequestRepository {
  addEvidence(command: AddQaEvidenceCommand): Promise<string>;
  completeChecklistAssessment(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    artifactId: string;
    status: "PASSED" | "SUGGESTIONS";
    summary?: string;
    suggestions: Array<Record<string, unknown>>;
    provider?: string;
    model?: string;
    processing?: QaProcessingLease;
  }): Promise<void>;
  failChecklistAssessment(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    artifactId: string;
    errorCode: string;
    processing?: QaProcessingLease;
  }): Promise<void>;
  failChecklistGeneration(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    errorCode: string;
    processing?: QaProcessingLease;
  }): Promise<void>;
  createRequest(command: CreateQaRequestCommand): Promise<string>;
  finishRun(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    runId: string;
    expectedVersion: number;
  }): Promise<void>;
  getRequest(projectId: string, requestId: string): Promise<unknown | null>;
  getLatestContextSnapshot(
    projectId: string,
    requestId: string
  ): Promise<QaContextSnapshotInput | null>;
  listRequests(input: {
    projectId: string;
    cursor?: QaRequestListCursor;
    limit: number;
  }): Promise<QaRequestListItem[]>;
  recordCheckResult(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    runId: string;
    checklistItemId: string;
    status: QaCheckResultStatus;
    observedResult?: string;
    notes?: string;
    expectedVersion: number;
  }): Promise<void>;
  startChecklistGeneration(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
  }): Promise<void>;
  reviewRun(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    runId: string;
    decision: QaReviewDecision;
    comment?: string;
    expectedRunVersion: number;
  }): Promise<void>;
  selectArtifact(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    artifactId: string;
    expectedRequestVersion: number;
  }): Promise<void>;
  startRun(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    sourceLabel?: string;
    externalRunRef?: string;
    commitSha?: string;
  }): Promise<string>;
  submitChecklist(command: SubmitQaChecklistCommand): Promise<string>;
}

export interface ProjectQaContextBuilder {
  build(input: {
    projectId: string;
    title: string;
    objective: string;
    target?: string;
    environment?: string;
    acceptanceNotes?: string;
    userId?: string;
  }): Promise<QaContextSnapshotInput>;
}

export interface QaChecklistGenerator {
  generate(input: {
    requestId: string;
    snapshot: QaContextSnapshotInput;
    userId?: string;
    signal?: AbortSignal;
  }): Promise<{ checklist: QaChecklistDraft; provider?: string; model?: string }>;
}

export interface QaChecklistReviewer {
  review(input: {
    requestId: string;
    artifactId: string;
    snapshot: QaContextSnapshotInput;
    checklist: QaChecklistDraft;
    userId?: string;
    signal?: AbortSignal;
  }): Promise<{
    status: Exclude<QaChecklistAssessmentStatus, "PENDING" | "FAILED">;
    summary?: string;
    suggestions: Array<Record<string, unknown>>;
    provider?: string;
    model?: string;
  }>;
}
