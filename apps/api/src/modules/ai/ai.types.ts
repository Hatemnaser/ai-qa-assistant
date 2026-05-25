import type { QaWorkflowAnalysis } from "./qa-workflow.js";

export type AiRole = "user" | "assistant";
export type AiProviderId = "gemini";

export interface AiHistoryMessage {
  role?: AiRole;
  content: string;
  mode?: string;
  model?: string;
}

export interface AiImage {
  mimeType: string;
  data: string;
}

export interface AiTextAttachment {
  type: "file";
  name?: string;
  mimeType: string;
  content: string;
}

export interface AiChatInput {
  message: string;
  mode: string;
  model?: string;
  provider?: string;
  history: AiHistoryMessage[];
  attachments?: AiTextAttachment[];
  image?: AiImage;
  images?: AiImage[];
  workflow?: QaWorkflowAnalysis;
}

export interface AiChatResponse {
  reply: string;
  model: string;
  modelRouting?: AiModelRouting;
  provider?: string;
  usage?: AiTokenUsage;
  workflow?: QaWorkflowAnalysis;
}

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type AiModelRoutingSource = "fallback" | "policy" | "requested";

export interface AiModelRouting {
  reason: string;
  requestedModel: string;
  selectedModel: string;
  source: AiModelRoutingSource;
}

export interface AiErrorDetails {
  code?: string | number;
  httpStatus?: number;
  message: string;
  status?: string;
}

export interface AiModelCapabilities {
  images: boolean;
  text: boolean;
  textAttachments: boolean;
}

export interface AiModelConfig {
  capabilities: AiModelCapabilities;
  label: string;
  provider: AiProviderId;
  recommendedFor: string;
  value: string;
}

export interface AiResolvedModel {
  config: AiModelConfig;
  model: string;
  provider: AiProviderId;
}

export interface AiProviderAdapter {
  chat(input: AiChatInput): Promise<AiChatResponse>;
  defaultModel: string;
  id: AiProviderId;
  label: string;
  models: readonly AiModelConfig[];
}
