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

export type QaEvidenceKind = "TEXT" | "SCREENSHOT" | "LOG" | "TRACE" | "FILE" | "REFERENCE";
export type QaCheckResultStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type QaOperationStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
export type QaExecutionJobStatus =
  | "QUEUED"
  | "CLAIMED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
export type QaExecutionMode = "CONNECTED_AGENT" | "PLAYWRIGHT";

export interface QaRequestSummary {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  phase: QaRequestPhase;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface QaEvidenceRequirement {
  id: string;
  checklistItemId: string;
  ordinal: number;
  kind: QaEvidenceKind;
  description: string;
  required: boolean;
  createdAt: string;
}

export interface QaChecklistItem {
  id: string;
  artifactId: string;
  ordinal: number;
  clientRef: string | null;
  title: string;
  category: string | null;
  priority: string | null;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  createdAt: string;
  evidenceRequirements: QaEvidenceRequirement[];
}

export interface QaChecklistAssessment {
  id: string;
  status: "PENDING" | "PASSED" | "SUGGESTIONS" | "FAILED";
  summary: string | null;
  suggestions: Array<{
    code?: string;
    message?: string;
    severity?: string;
    itemClientRef?: string;
    proposedChange?: string;
  }>;
  provider?: string | null;
  model?: string | null;
  errorCode?: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface QaArtifact {
  id: string;
  requestId: string;
  revision: number;
  origin: "ODDPATH_GENERATED" | "AGENT_PROVIDED";
  title: string;
  lockedAt: string | null;
  createdAt: string;
  assessments: QaChecklistAssessment[];
  items: QaChecklistItem[];
}

export type QaRecipeLocator =
  | { by: "role"; role: string; name: string; exact?: boolean; index?: number }
  | { by: "label" | "placeholder" | "text"; value: string; exact?: boolean; index?: number }
  | { by: "testId"; value: string; index?: number };

export type QaRecipeValue =
  | { source: "literal"; value: string }
  | { source: "profile"; key: string };

type QaRecipeStepBase = { ref: string; timeoutMs?: number };
type QaRecipeExpectation =
  | { kind: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked"; locator: QaRecipeLocator }
  | { kind: "textEquals" | "textContains" | "valueEquals"; locator: QaRecipeLocator; expected: string }
  | { kind: "countEquals"; locator: QaRecipeLocator; expected: number }
  | { kind: "urlPathEquals" | "urlPathContains"; expected: string };

export type QaRecipeStep = QaRecipeStepBase & (
  | { action: "navigate"; path: string; waitUntil: "domcontentloaded" | "load" }
  | { action: "click" | "hover"; locator: QaRecipeLocator }
  | { action: "fill"; locator: QaRecipeLocator; value: QaRecipeValue }
  | { action: "select"; locator: QaRecipeLocator; option: { by: "label" | "value"; value: QaRecipeValue } }
  | { action: "check"; locator: QaRecipeLocator; checked: boolean }
  | { action: "press"; locator: QaRecipeLocator; key: string }
  | { action: "expect"; expectation: QaRecipeExpectation }
);

export interface QaProfileManifest {
  schemaVersion: 1;
  profileKey: string;
  label: string;
  environmentKind: "LOCAL" | "TEST" | "STAGING" | "PRODUCTION";
  executorKey: "playwright";
  recipeSchemaVersions: [1];
  evidenceKinds: Array<"TEXT" | "SCREENSHOT">;
  valueReferences: Array<{ key: string; secret: boolean }>;
  manifestHash?: string;
}

export interface QaRecipeBundle {
  schemaVersion: 1;
  engine: "playwright";
  items: Array<{
    checklistItemId: string;
    steps: QaRecipeStep[];
  }>;
}

export interface QaExecutionRecipeAssessment {
  id: string;
  status: "PENDING" | "PASSED" | "SUGGESTIONS" | "FAILED";
  summary: string | null;
  suggestions: QaChecklistAssessment["suggestions"];
  provider?: string | null;
  model?: string | null;
  errorCode?: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface QaExecutionRecipe {
  id: string;
  requestId: string;
  artifactId: string;
  revision: number;
  origin: "ODDPATH_GENERATED" | "AGENT_PROVIDED";
  title: string;
  schemaVersion: 1;
  executorKey: "playwright";
  recipeHash: string;
  hash?: string;
  bundle: QaRecipeBundle;
  profileManifest: QaProfileManifest | null;
  profileManifestHash: string | null;
  supersedesRecipeId: string | null;
  items: Array<{
    checklistItemId: string;
    ordinal: number;
    steps: QaRecipeStep[];
  }>;
  assessments: QaExecutionRecipeAssessment[];
  createdAt: string;
}

export interface QaOperationReceipt {
  operationId: string;
  kind:
    | "CHECKLIST_GENERATION"
    | "CHECKLIST_REVIEW"
    | "EXECUTION_RECIPE_GENERATION"
    | "EXECUTION_RECIPE_REVIEW";
  status: QaOperationStatus;
  requestId: string;
  artifactId?: string | null;
  recipeId?: string | null;
  errorCode?: string | null;
  attempts?: number;
  availableAt?: string | null;
  completedAt?: string | null;
}

export interface QaRunnerProfile {
  id: string;
  runnerRegistrationId: string;
  runnerName: string;
  runnerInstanceId: string;
  runnerVersion: string;
  key: string;
  label: string;
  environmentKind: "LOCAL" | "TEST" | "STAGING" | "PRODUCTION";
  status: "ONLINE" | "OFFLINE" | "INCOMPATIBLE";
  supportedRecipeVersions: number[];
  valueRefs: Array<{ name: string; secret: boolean }>;
  evidenceKinds: Array<"TEXT" | "SCREENSHOT">;
  manifestHash: string | null;
  lastSeenAt: string | null;
}

export interface QaExecutionJob {
  id: string;
  runId: string;
  recipeId: string;
  runnerRegistrationId: string;
  profileKey: string;
  status: QaExecutionJobStatus;
  completedItems: number;
  totalItems: number;
  failureCode: string | null;
  failureMessage: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QaCheckResult {
  id: string;
  runId: string;
  checklistItemId: string;
  status: QaCheckResultStatus;
  observedResult: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QaEvidenceAsset {
  id: string;
  ordinal: number;
  asset: {
    id: string;
    originalName: string;
    declaredMimeType: string;
    detectedMimeType: string | null;
    sizeBytes: number | null;
    status: string;
    readyAt: string | null;
  };
}

export interface QaEvidence {
  id: string;
  runId: string;
  checklistItemId: string | null;
  requirementId: string | null;
  actorKind: "USER" | "INTEGRATION" | "SYSTEM";
  transport: "WEB" | "REST" | "MCP" | "SYSTEM";
  kind: QaEvidenceKind;
  textContent: string | null;
  externalReference: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  assets: QaEvidenceAsset[];
}

export interface QaRun {
  id: string;
  requestId: string;
  artifactId: string;
  status: "CREATED" | "ACTIVE" | "RESULTS_SUBMITTED" | "CANCELLED";
  outcome: "NOT_RUN" | "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE";
  version: number;
  sourceLabel: string | null;
  externalRunRef: string | null;
  commitSha: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  executionMode?: QaExecutionMode | null;
  executionJob?: QaExecutionJob | null;
  results: QaCheckResult[];
  evidence: QaEvidence[];
}

export interface QaHumanReview {
  id: string;
  runId: string;
  artifactId: string;
  decision: "APPROVED" | "CHANGES_REQUESTED";
  comment: string | null;
  runVersion: number;
  createdAt: string;
}

export interface QaWorkflowEvent {
  id: string;
  sequence: number;
  type: string;
  actorKind: "USER" | "INTEGRATION" | "SYSTEM";
  transport: "WEB" | "REST" | "MCP" | "SYSTEM";
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface QaRequestDetail extends QaRequestSummary {
  sample?: boolean;
  target: string | null;
  environment: string | null;
  acceptanceNotes: string | null;
  selectedArtifactId: string | null;
  contextSnapshots: Array<{
    id: string;
    version: number;
    schemaVersion: number;
    payloadHash: string;
    retrievalMode: string;
    degraded: boolean;
    createdAt: string;
  }>;
  artifacts: QaArtifact[];
  executionRecipes?: QaExecutionRecipe[];
  operations?: QaOperationReceipt[];
  runs: QaRun[];
  reviews: QaHumanReview[];
  events: QaWorkflowEvent[];
}

export interface CreateQaRequestInput {
  title: string;
  objective: string;
  target?: string;
  environment?: string;
  acceptanceNotes?: string;
  checklistMode: "ODDPATH_GENERATED" | "AGENT_PROVIDED";
}

export interface ProjectConnection {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  preset?: "AGENT" | "RUNNER";
}

export interface StartQaRunInput {
  executionMode: QaExecutionMode;
  expectedRequestVersion: number;
  recipeId?: string;
  recipeHash?: string;
  runnerRegistrationId?: string;
  profileKey?: string;
  confirmProduction?: boolean;
}

export interface CreateQaRequestResult {
  request: QaRequestDetail;
  operation: QaOperationReceipt | null;
}
