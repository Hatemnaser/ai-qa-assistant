import type { QaOperationReceipt, QaRequestDetail, QaRequestPhase, QaRequestSummary, QaRun } from "../qa/types";
import type { TestPreparation, TestSessionDetail } from "../test-sessions/types";
import type { TranslationKey } from "../../i18n/messages";
import { sessionTimeline } from "./sessionTimeline";

export type SessionActivityGroup = "active" | "completed" | "attention";
export interface SessionActivityItem {
  id: string;
  kind: "assistant" | "preparation" | "request" | "operation" | "run";
  group: SessionActivityGroup;
  labelKey: TranslationKey | null;
  title: string | null;
  statusKey: TranslationKey;
  requestId: string | null;
  current: boolean;
  viewed: boolean;
  timestamp: string | null;
  errorCode: string | null;
  outcome: QaRun["outcome"] | null;
  progress: { completed: number; total: number } | null;
}

export interface SessionActivityEvent {
  id: string;
  requestId: string;
  title: string;
  type: string;
  labelKey: TranslationKey;
  sequence: number;
  timelinePosition: number | null;
  createdAt: string;
  current: boolean;
  viewed: boolean;
}

export interface SessionActivityInput {
  session: TestSessionDetail | null;
  request: QaRequestDetail | null;
  loading?: boolean;
  readError?: boolean;
}

const eventLabels = {
  REQUEST_CREATED: "requestCreated",
  CHECKLIST_GENERATION_STARTED: "checklistGenerationStarted",
  CHECKLIST_GENERATION_FAILED: "checklistGenerationFailed",
  CHECKLIST_SUBMITTED: "checklistSubmitted",
  CHECKLIST_ASSESSED: "checklistAssessed",
  CHECKLIST_ASSESSMENT_FAILED: "checklistAssessmentFailed",
  CHECKLIST_SELECTED: "checklistSelected",
  EXECUTION_RECIPE_GENERATION_QUEUED: "recipeGenerationQueued",
  EXECUTION_RECIPE_GENERATION_FAILED: "recipeGenerationFailed",
  EXECUTION_RECIPE_SUBMITTED: "recipeSubmitted",
  EXECUTION_RECIPE_REVIEW_RETRIED: "recipeReviewRetried",
  EXECUTION_RECIPE_ASSESSED: "recipeAssessed",
  EXECUTION_RECIPE_ASSESSMENT_FAILED: "recipeAssessmentFailed",
  RUN_STARTED: "runStarted",
  EXECUTION_QUEUED: "executionQueued",
  EXECUTION_CLAIMED: "executionClaimed",
  EXECUTION_STARTED: "executionStarted",
  EXECUTION_FAILED: "executionFailed",
  EXECUTION_CANCELLED: "executionCancelled",
  CHECK_RESULT_RECORDED: "checkResultRecorded",
  EVIDENCE_ADDED: "evidenceAdded",
  RUN_RESULTS_SUBMITTED: "runResultsSubmitted",
  HUMAN_REVIEW_RECORDED: "humanReviewRecorded",
} as const;

/** Unknown future events stay visible without asserting what they mean. */
export function qaEventLabelKey(type: string): TranslationKey {
  return `sessionTools.events.${eventLabels[type.toUpperCase() as keyof typeof eventLabels] || "recorded"}`;
}

/** A display filter only; the complete original history remains in Activity/Results. */
export function isPrimarySessionEvent(type: string): boolean {
  return !["CHECK_RESULT_RECORDED", "EVIDENCE_ADDED"].includes(type.toUpperCase());
}

const activePhases: readonly QaRequestPhase[] = ["GENERATING", "CHECKLIST_REVIEW", "RUNNING"];
const completedPhases: readonly QaRequestPhase[] = ["APPROVED", "CANCELLED"];
const activePreparations: readonly TestPreparation["status"][] = ["CHECKLIST", "RECIPE", "REVIEW"];

/** No authorization, polling, inferred success, or writes belong in this projection. */
export function sessionActivityPresentation(input: SessionActivityInput) {
  const { session } = input;
  // Late or wrongly scoped detail may never masquerade as work in this session.
  const detail = input.request && (!session || session.projectId === input.request.projectId
    && session.requests.some(request => request.id === input.request!.id)) ? input.request : null;
  const currentRequestId = session?.currentRequestId || (!session ? detail?.id : null) || null;
  const selectedRequestId = detail?.id || null;
  const requestMap = new Map<string, QaRequestSummary>();
  for (const request of session?.requests || []) {
    if (request.projectId === session?.projectId) requestMap.set(request.id, request);
  }
  if (detail) requestMap.set(detail.id, detail);
  const requests = [...requestMap.values()];
  const items = new Map<string, SessionActivityItem>();
  const add = (item: Omit<SessionActivityItem, "current" | "viewed">) => items.set(item.id, {
    ...item,
    current: Boolean(item.requestId && item.requestId === currentRequestId),
    viewed: Boolean(item.requestId && item.requestId === selectedRequestId),
  });
  const base = { title: null, requestId: null, timestamp: null, errorCode: null, outcome: null, progress: null } as const;
  const turn = session?.turnStatus;
  if (turn) add({
    ...base, id: `turn:${turn.id}`, kind: "assistant", labelKey: "sessionTools.activity.assistant",
    group: workGroup(turn.status), statusKey: workStatusKey(turn.status), errorCode: turn.errorCode,
  });
  const preparation = session?.preparation;
  if (preparation && requestMap.has(preparation.requestId)) add({
    ...base, id: `preparation:${preparation.id}`, kind: "preparation", labelKey: "sessionTools.activity.preparation",
    group: activePreparations.includes(preparation.status) ? "active" : preparation.status === "READY" ? "completed" : "attention",
    statusKey: `sessionTools.activity.preparationState.${preparation.status}`,
    requestId: preparation.requestId, title: requestMap.get(preparation.requestId)!.title,
    errorCode: preparation.errorCode,
  });
  for (const request of requests) add({
    ...base, id: `request:${request.id}`, kind: "request", labelKey: null, title: request.title,
    group: activePhases.includes(request.phase) ? "active" : completedPhases.includes(request.phase) ? "completed" : "attention",
    statusKey: `projects.qa.focus.phase.${request.phase}`, requestId: request.id,
    timestamp: actualDate(request.updatedAt),
  });
  for (const operation of detail?.operations || []) {
    if (operation.requestId !== detail!.id) continue;
    add({
      ...base, id: `operation:${operation.operationId}`, kind: "operation",
      labelKey: operationLabelKey(operation.kind), title: detail!.title,
      group: workGroup(operation.status), statusKey: workStatusKey(operation.status),
      requestId: detail!.id, timestamp: actualDate(operation.completedAt), errorCode: operation.errorCode || null,
    });
  }
  for (const run of detail?.runs || []) {
    if (run.requestId !== detail!.id) continue;
    const job = run.executionJob?.runId === run.id ? run.executionJob : null;
    const working = ["CREATED", "ACTIVE"].includes(run.status)
      && (!job || ["QUEUED", "CLAIMED", "RUNNING"].includes(job.status));
    const failed = job?.status === "FAILED";
    const cancelled = run.status === "CANCELLED" || job?.status === "CANCELLED";
    add({
      ...base, id: `run:${run.id}`, kind: "run", labelKey: "sessionTools.activity.execution", title: detail!.title,
      group: failed ? "attention" : working ? "active" : "completed",
      statusKey: failed ? "sessionTools.activity.state.failed" : cancelled ? "sessionTools.activity.state.cancelled"
        : working ? run.status === "CREATED" || job?.status === "QUEUED" ? "sessionTools.activity.state.waiting" : "sessionTools.activity.state.working"
        : "sessionTools.activity.state.completed",
      requestId: detail!.id, timestamp: actualDate(job?.completedAt || run.submittedAt || run.startedAt),
      errorCode: job?.failureCode || null, outcome: run.outcome,
      progress: job && Number.isInteger(job.totalItems) && job.totalItems > 0 && Number.isInteger(job.completedItems)
        && job.completedItems >= 0 && job.completedItems <= job.totalItems
        ? { completed: job.completedItems, total: job.totalItems } : null,
    });
  }

  const events = activityEvents(session, detail, requestMap, currentRequestId, selectedRequestId);
  const all = [...items.values()];
  return {
    loading: Boolean(input.loading), readError: Boolean(input.readError),
    currentRequestId, selectedRequestId, requests,
    active: all.filter(item => item.group === "active"),
    completed: all.filter(item => item.group === "completed"),
    attention: all.filter(item => item.group === "attention"), events,
  };
}

function activityEvents(session: TestSessionDetail | null, detail: QaRequestDetail | null,
  requests: Map<string, QaRequestSummary>, currentId: string | null, selectedId: string | null): SessionActivityEvent[] {
  const byId = new Map<string, NonNullable<TestSessionDetail["events"]>[number]>();
  for (const event of session?.events || []) {
    if (requests.has(event.requestId)) byId.set(event.id, event);
  }
  for (const event of detail?.events || []) {
    const existing = byId.get(event.id);
    // The session position, when present, is authoritative. Detail enriches no clocks.
    if (!existing) byId.set(event.id, { ...event, requestId: detail!.id, title: detail!.title, timelinePosition: null });
  }
  const ordered = sessionTimeline({ messages: [], events: [...byId.values()] } as unknown as TestSessionDetail);
  return ordered.flatMap(entry => entry.kind === "event" ? [{
    id: entry.event.id, requestId: entry.event.requestId, title: entry.event.title,
    type: entry.event.type, labelKey: qaEventLabelKey(entry.event.type), sequence: entry.event.sequence,
    timelinePosition: entry.event.timelinePosition, createdAt: entry.event.createdAt,
    current: entry.event.requestId === currentId, viewed: entry.event.requestId === selectedId,
  }] : []);
}

function actualDate(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

function workGroup(status: string): SessionActivityGroup {
  return ["PENDING", "PROCESSING"].includes(status) ? "active" : status === "SUCCEEDED" ? "completed" : "attention";
}

function workStatusKey(status: QaOperationReceipt["status"]): TranslationKey {
  const states = { PENDING: "waiting", PROCESSING: "working", SUCCEEDED: "completed", FAILED: "failed" } as const;
  const label = states[status];
  return `sessionTools.activity.state.${label || "unknown"}`;
}

function operationLabelKey(kind: QaOperationReceipt["kind"]): TranslationKey {
  return `sessionTools.activity.operations.${kind}`;
}
