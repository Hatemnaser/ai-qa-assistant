import type { ChatAttachment, RequestAttachment } from "../chat/types";
import type { QaRequestSummary } from "../qa/types";

export interface TestSessionSummary {
  id: string;
  projectId: string;
  title: string;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  currentRequestId: string | null;
  phase?: QaRequestSummary["phase"];
  requestIds?: string[];
}

export interface TestSessionMessage {
  id: string;
  timelinePosition?: number | null;
  role: "user" | "assistant" | "system";
  content: string;
  mode?: string;
  createdAt: string;
  model: string | null;
  attachments?: ChatAttachment[];
}

export interface TestProposal {
  id: string;
  title: string;
  objective: string;
  target: string | null;
  environment: string | null;
  acceptanceNotes: string | null;
  sourceMessageIds: string[];
  ready: boolean;
}

export interface TestPreparation {
  id: string;
  requestId: string;
  status: "WAITING_PROFILE" | "CHECKLIST" | "RECIPE" | "REVIEW" | "READY" | "FAILED" | "STOPPED";
  recipeId: string | null;
  operationId: string | null;
  runnerRegistrationId: string | null;
  profileKey: string | null;
  errorCode: string | null;
}

export interface TestSessionDetail extends TestSessionSummary {
  managed?: boolean;
  events?: Array<{ id: string; requestId: string; title: string; type: string; sequence: number; timelinePosition: number | null; createdAt: string; metadata: unknown }>;
  messages: TestSessionMessage[];
  requests: QaRequestSummary[];
  pendingProposal: TestProposal | null;
  turnStatus: {
    id: string;
    status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
    errorCode: string | null;
  } | null;
  preparation: TestPreparation | null;
}

export interface TestSessionList {
  sessions: TestSessionSummary[];
  unlinkedRequests: QaRequestSummary[];
}

export interface TestTurnInput {
  expectedUpdatedAt?: string;
  clientTurnId: string;
  expectedSessionVersion: number;
  content: string;
  attachments?: RequestAttachment[];
  model?: string;
  mode?: "general" | "test_cases" | "bug_report" | "edge_cases" | "checklist" | "screenshot_review";
}

export interface TestScope {
  projectId: string;
  sessionId?: string;
  requestId?: string;
}
