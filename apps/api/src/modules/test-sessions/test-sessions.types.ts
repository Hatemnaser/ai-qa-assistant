import type { QaRequestPhase } from "../qa-requests/qa-requests.types.js";

export interface TestSessionSummary {
  id: string;
  projectId: string;
  title: string;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentRequestId: string | null;
  phase: QaRequestPhase | "DRAFT";
  requestIds: string[];
}

export interface TestSessionProposal {
  id: string;
  title: string;
  objective: string;
  target: string | null;
  environment: string | null;
  acceptanceNotes: string | null;
  sourceMessageIds: string[];
  ready: boolean;
}

export interface TestSessionRequestSummary {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  phase: QaRequestPhase;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestSessionDetail extends TestSessionSummary {
  messages: Array<{
    id: string;
    timelinePosition?: number | null;
    role: "user" | "assistant" | "system";
    content: string;
    mode: string;
    createdAt: string;
    model: string | null;
    attachments?: unknown[];
  }>;
  events?: Array<{ id: string; requestId: string; title: string; type: string; sequence: number; timelinePosition: number | null; createdAt: string; metadata: unknown }>;
  requests: TestSessionRequestSummary[];
  pendingProposal: TestSessionProposal | null;
  turnStatus: {
    id: string;
    status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
    errorCode: string | null;
  } | null;
  preparation: {
    id: string;
    requestId: string;
    status: "WAITING_PROFILE" | "CHECKLIST" | "RECIPE" | "REVIEW" | "READY" | "FAILED" | "STOPPED";
    recipeId: string | null;
    operationId: string | null;
    runnerRegistrationId: string | null;
    profileKey: string | null;
    errorCode: string | null;
  } | null;
}
