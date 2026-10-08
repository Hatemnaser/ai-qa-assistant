import type {
  QaArtifact,
  QaChecklistItem,
  QaCheckResult,
  QaEvidence,
  QaEvidenceRequirement,
  QaRequestDetail,
  QaRun,
} from "./types";

type WorkspaceNextState =
  | "loading" | "busy" | "loadFailed" | "empty" | "sample" | "generating" | "generationFailed"
  | "awaitingChecklist" | "reviewingChecklist" | "checklistReady" | "checklistReviewFailed"
  | "preparing" | "changesRequested" | "running" | "externalRunning"
  | "executionFailed" | "executionCancelled" | "evidence" | "review"
  | "approved" | "results" | "unavailable";
type WorkspaceAction = "create" | "select" | "prepare" | "refresh" | "evidence" | "review" | "results" | "connect";
type WorkspaceTone = "neutral" | "active" | "warning" | "danger" | "success";

export interface QaWorkspaceNextActionInput {
  request: QaRequestDetail | null;
  artifact: QaArtifact | null;
  run: QaRun | null;
  isLoading: boolean;
  loadError?: boolean;
  isSample: boolean;
  canSelectArtifact: boolean;
  canStartRun: boolean;
  canReview: boolean;
  missingEvidenceCount: number;
  isBusy: boolean;
}

/** Presentation only: the existing domain controls still authorize mutations. */
export function qaWorkspaceNextAction(input: QaWorkspaceNextActionInput) {
  const { request, artifact, run } = input;
  if (input.isLoading) return next("loading", null, "neutral", true);
  if (input.isBusy) return next("busy", null, "active", true);
  if (input.loadError) return next("loadFailed", "refresh", "danger");
  if (!request) return next("empty", "create");
  if (input.isSample || request.sample) return next("sample", "create");

  if (request.phase === "APPROVED") return next("approved", "results", "success");

  const activeJob = run?.executionJob && ["QUEUED", "CLAIMED", "RUNNING"].includes(run.executionJob.status);
  if (activeJob || run?.status === "CREATED" || run?.status === "ACTIVE") {
    return run?.executionMode === "PLAYWRIGHT"
      ? next("running", null, "active")
      : next("externalRunning", "refresh", "active");
  }

  // Cancelled/failed partial runs may still lack evidence. They must not prevent
  // a new approved execution when the domain says the request can run again.
  if (input.canStartRun) {
    if (run?.executionJob?.status === "FAILED") return next("executionFailed", "prepare", "danger");
    if (run?.status === "CANCELLED" || run?.executionJob?.status === "CANCELLED") {
      return next("executionCancelled", "prepare", "neutral");
    }
    if (request.phase === "CHANGES_REQUESTED") return next("changesRequested", "prepare", "warning");
    // Recipe revisions and profile availability are resolved inside the run
    // dialog, not inferred from only the latest Recipe on the overview.
    return next("preparing", "prepare");
  }

  if (run?.status === "RESULTS_SUBMITTED" && input.missingEvidenceCount > 0) {
    return next("evidence", "evidence", "warning");
  }
  if (input.canReview) return next("review", "review");

  const pendingGeneration = request.phase === "GENERATING" || request.operations?.some((operation) =>
    operation.requestId === request.id && operation.kind === "CHECKLIST_GENERATION"
      && ["PENDING", "PROCESSING"].includes(operation.status)
  );
  if (pendingGeneration) return next("generating", null, "active");
  if (!artifact) {
    if (request.phase === "PROCESSING_FAILED") return next("generationFailed", "create", "danger");
    if (request.phase === "DRAFT") return next("awaitingChecklist", "connect");
    return next("unavailable", "refresh", "warning");
  }

  const assessment = artifact.assessments[0];
  const pendingReview = assessment?.status === "PENDING" || request.operations?.some((operation) =>
    operation.requestId === request.id && operation.artifactId === artifact.id
      && operation.kind === "CHECKLIST_REVIEW" && ["PENDING", "PROCESSING"].includes(operation.status)
  );
  if (!request.selectedArtifactId && pendingReview) return next("reviewingChecklist", null, "active");
  if (input.canSelectArtifact) {
    return assessment?.status === "FAILED"
      ? next("checklistReviewFailed", "select", "warning")
      : next("checklistReady", "select");
  }

  if (run?.executionJob?.status === "FAILED") return next("executionFailed", null, "danger");
  if (run?.status === "CANCELLED" || run?.executionJob?.status === "CANCELLED") {
    return next("executionCancelled", null);
  }
  if (run?.status === "RESULTS_SUBMITTED") return next("results", "results");
  return next("unavailable", "refresh", "warning");
}

function next(state: WorkspaceNextState, action: WorkspaceAction | null, tone: WorkspaceTone = "neutral", disabled = false) {
  return {
    titleKey: `projects.qa.focus.next.${state}Title` as const,
    messageKey: `projects.qa.focus.next.${state}Body` as const,
    action,
    actionKey: action ? `projects.qa.focus.actions.${action}` as const : null,
    tone,
    disabled,
  };
}

export interface QaChecklistEvidence {
  item: QaChecklistItem;
  result: QaCheckResult | null;
  evidence: QaEvidence[];
  missingRequirements: QaEvidenceRequirement[];
}

/** Keep requirement-linked proof beside its check even without an item link. */
export function qaChecklistEvidence(artifact: QaArtifact | null, run: QaRun | null): QaChecklistEvidence[] {
  if (!artifact) return [];
  const currentRun = run?.artifactId === artifact.id ? run : null;
  const requirementOwners = new Map(artifact.items.flatMap((item) =>
    item.evidenceRequirements.map((requirement) => [requirement.id, item.id] as const)
  ));
  return artifact.items.map((item) => {
    const evidence = (currentRun?.evidence || []).filter((entry) => evidenceOwner(entry, requirementOwners) === item.id);
    // As in the domain, only an exact requirement ID fulfills required proof.
    const fulfilled = new Set(evidence.map((entry) => entry.requirementId));
    return {
      item,
      result: currentRun?.results.find((result) => result.checklistItemId === item.id) || null,
      evidence,
      missingRequirements: currentRun
        ? item.evidenceRequirements.filter((requirement) => requirement.required && !fulfilled.has(requirement.id))
        : [],
    };
  });
}

/** Unmatched/unscoped proof stays visible rather than disappearing in a join. */
export function qaGeneralEvidence(artifact: QaArtifact | null, run: QaRun | null): QaEvidence[] {
  if (!run) return [];
  if (!artifact || run.artifactId !== artifact.id) return [...run.evidence];
  const items = new Set(artifact.items.map((item) => item.id));
  const requirementOwners = new Map(artifact.items.flatMap((item) =>
    item.evidenceRequirements.map((requirement) => [requirement.id, item.id] as const)
  ));
  return run.evidence.filter((entry) => !items.has(evidenceOwner(entry, requirementOwners) || ""));
}

function evidenceOwner(entry: QaEvidence, requirementOwners: ReadonlyMap<string, string>) {
  return (entry.requirementId ? requirementOwners.get(entry.requirementId) : null) || entry.checklistItemId;
}
