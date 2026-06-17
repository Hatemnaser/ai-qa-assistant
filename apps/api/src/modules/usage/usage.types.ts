export const CHAT_MESSAGE_ACTION = "chat_message";
export const CONVERSATION_SUMMARY_ACTION = "conversation_summary";

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
  status?: string;
  totalTokens?: number;
  units: number;
  userId?: string;
  workflowIntent?: string;
  workflowSource?: string;
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
  status?: string;
  totalTokens?: number;
  units?: number;
  workflowIntent?: string;
  workflowSource?: string;
}

export interface UsageReservation {
  eventId?: string;
  limit: number;
  remaining: number;
  reserved?: number;
  unit: "credits";
  used: number;
}
