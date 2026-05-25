export const CHAT_MESSAGE_ACTION = "chat_message";

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
