import type { Chat } from "../chat/types";
import type { QaRequestDetail } from "../qa/types";
import type { TestSessionDetail } from "./types";

export function testSessionNeedsPolling(session: TestSessionDetail | null, request: QaRequestDetail | null) {
  return Boolean(
    session?.turnStatus && ["PENDING", "PROCESSING"].includes(session.turnStatus.status)
    || sessionQaNeedsPolling(session, request)
  );
}

export function sessionQaNeedsPolling(session: TestSessionDetail | null, request: QaRequestDetail | null) {
  return Boolean(
    session?.preparation && ["CHECKLIST", "RECIPE", "REVIEW"].includes(session.preparation.status)
    || session?.requests.some(item => ["GENERATING", "CHECKLIST_REVIEW", "RUNNING"].includes(item.phase))
    || request?.operations?.some(operation => ["PENDING", "PROCESSING"].includes(operation.status))
    || request?.runs.some(run => ["CREATED", "ACTIVE"].includes(run.status))
  );
}

export function testSessionCanPrepare(session: TestSessionDetail | null, request: QaRequestDetail | null) {
  if (!session?.pendingProposal?.ready || session.archivedAt) return false;
  if (testSessionNeedsPolling(session, request)) return false;
  if (session.preparation && !["READY", "FAILED", "STOPPED"].includes(session.preparation.status)) return false;
  // The displayed record may be historical. A new brief must respect the
  // session's current request, not the state of that historical record.
  if (!session.currentRequestId) return true;
  const current = request?.id === session.currentRequestId
    ? request : session.requests.find(item => item.id === session.currentRequestId);
  if (!current) return false;
  return ["APPROVED", "CANCELLED", "PROCESSING_FAILED", "READY_FOR_REVIEW", "EVIDENCE_NEEDED", "CHANGES_REQUESTED"].includes(current.phase)
    || Boolean(request?.id === current.id && request.runs.some(run => ["RESULTS_SUBMITTED", "CANCELLED"].includes(run.status)));
}

/** Export is deliberately an ordinary, inert conversation, never an execution import. */
export function testSessionTranscript(session: TestSessionDetail, notice: string): Chat {
  return {
    id: session.id, projectId: session.projectId || null, title: session.title,
    mode: "general", model: "", createdAt: session.createdAt, updatedAt: session.updatedAt,
    messages: [...(session.requests.length || session.messages.some(message => message.role === 'system') || session.preparation ? [{
      id: `${session.id}:export-notice`, role: "assistant", content: notice,
      mode: "general", model: "", createdAt: session.createdAt,
    } as const] : []), ...session.messages.map(message => ({
      id: message.id, role: message.role === "user" ? "user" as const : "assistant" as const,
      content: message.role === "system" ? `[Recorded activity]\n${message.content}` : message.content,
      mode: message.mode || "general", model: message.model || "", createdAt: message.createdAt,
      attachments: message.attachments,
    }))],
  };
}
