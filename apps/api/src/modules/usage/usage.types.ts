export const CHAT_MESSAGE_ACTION = "chat_message";
export const CONVERSATION_SUMMARY_ACTION = "conversation_summary";
export const DOCUMENT_EMBEDDING_ACTION = "document_embedding";
export const RAG_QUERY_EMBEDDING_ACTION = "rag_query_embedding";
export const AI_USAGE_ACTIONS = [
  CHAT_MESSAGE_ACTION,
  CONVERSATION_SUMMARY_ACTION,
  DOCUMENT_EMBEDDING_ACTION,
  RAG_QUERY_EMBEDDING_ACTION,
] as const;

export interface UsageIdentity {
  guestId?: string;
  ipAddress?: string;
  userId?: string;
}

export interface UsageCountInput {
  action: string;
  guestId?: string;
  ipHash?: string;
  since: Date;
  userId?: string;
}

export interface UsageListInput extends UsageCountInput {}

export interface UsageRecordInput {
  action: string;
  attachmentCount?: number;
  creditsReserved?: number;
  creditsUsed?: number;
  estimatedOutputTokens?: number;
  estimatedPromptTokens?: number;
  estimatedTotalTokens?: number;
  fileCount?: number;
  guestId?: string;
  imageCount?: number;
  ipHash?: string;
  mode?: string;
  model?: string;
  modelRoutingSource?: string;
  outputTokens?: number;
  promptTokens?: number;
  provider?: string;
  providerAttempts?: number;
  status?: string;
  totalTokens?: number;
  units: number;
  userId?: string;
  workflowIntent?: string;
  workflowSource?: string;
}

export interface UsageReservationInput {
  action: string;
  event: UsageRecordInput;
  globalGuard?: UsageGlobalGuardInput;
  guestId?: string;
  ipHash?: string;
  isSignedIn: boolean;
  inFlightLimit?: number;
  limit: number;
  requestedUnits: number;
  scopeActions?: readonly string[];
  since: Date;
  userId?: string;
}

export interface UsageGlobalGuardInput {
  additionalWindows?: readonly UsageGlobalGuardWindow[];
  creditLimit: number;
  requestLimit: number;
  since: Date;
  staleReservedCutoff: Date;
}

export interface UsageGlobalGuardWindow {
  creditLimit: number;
  requestLimit: number;
  since: Date;
}

export type UsageReservationRejectionReason =
  | "global_limit"
  | "identity_in_flight"
  | "identity_limit";

export interface UsageReservationRecord {
  accepted: boolean;
  eventId?: string;
  rejectionReason?: UsageReservationRejectionReason;
  usedAfter: number;
  usedBefore: number;
}

export interface UsageCleanupStaleReservedInput {
  action: string;
  cutoff: Date;
  guestId?: string;
  ipHash?: string;
  userId?: string;
}

export interface UsageEventRecord {
  attachmentCount: number;
  createdAt: Date;
  creditsReserved: number | null;
  creditsUsed: number | null;
  estimatedOutputTokens: number | null;
  estimatedPromptTokens: number | null;
  estimatedTotalTokens: number | null;
  fileCount: number;
  id: string;
  imageCount: number;
  mode: string | null;
  model: string | null;
  modelRoutingSource: string | null;
  outputTokens: number | null;
  promptTokens: number | null;
  provider: string | null;
  providerAttempts: number;
  status: string;
  totalTokens: number | null;
  units: number;
  workflowIntent: string | null;
  workflowSource: string | null;
}

export interface UsageUpdateInput {
  creditsUsed?: number;
  id: string;
  mode?: string;
  model?: string;
  modelRoutingSource?: string;
  outputTokens?: number;
  promptTokens?: number;
  provider?: string;
  providerAttempts?: number;
  status?: string;
  totalTokens?: number;
  units?: number;
  workflowIntent?: string;
  workflowSource?: string;
}

export interface UsageReservation {
  eventId?: string;
  fixedCredits?: number;
  generationAttempts?: number;
  limit: number;
  providerAttempts?: number;
  remaining: number;
  reserved?: number;
  routerAttempts?: number;
  unit: "credits";
  used: number;
}

export interface UsageRepository {
  cleanupStaleReservedUsage(input: UsageCleanupStaleReservedInput): Promise<number>;
  countUsage(input: UsageCountInput): Promise<number>;
  listUsageEvents(input: UsageListInput): Promise<UsageEventRecord[]>;
  recordUsageAttempt(id: string): Promise<void>;
  recordUsage(input: UsageRecordInput): Promise<{ id: string }>;
  reserveUsage(input: UsageReservationInput): Promise<UsageReservationRecord>;
  updateUsage(input: UsageUpdateInput): Promise<void>;
}
