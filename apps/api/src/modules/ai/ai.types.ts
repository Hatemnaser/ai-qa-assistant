import type { AiHistoryMessage } from "./ai-message.types.js";
import type { QaWorkflowAnalysis } from "./qa-workflow.types.js";

export type { AiHistoryMessage, AiRole } from "./ai-message.types.js";
export type AiProviderId = "gemini";

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

export interface AiProjectDocumentChunkContext {
  chunkCount: number;
  chunkIndex: number;
  content: string;
  documentId: string;
  title: string;
}

export interface AiBehaviorContext {
  projectInstructions?: string;
}

export interface AiDurableMemoryContext {
  account: string[];
  project?: string;
}

export interface AiStoredEvidenceContext {
  projectDocuments: AiProjectDocumentChunkContext[];
}

export interface AiEvidenceContext extends AiStoredEvidenceContext {
  attachments: AiTextAttachment[];
}

export interface AiConversationContext {
  recentTurns: AiHistoryMessage[];
  summary?: string;
}

export interface AiContextEnvelope {
  behavior: AiBehaviorContext;
  conversation: AiConversationContext;
  currentMessage: string;
  durableMemory: AiDurableMemoryContext;
  evidence: AiEvidenceContext;
}

export interface AiMemoryContext {
  behavior: AiBehaviorContext;
  durableMemory: AiDurableMemoryContext;
  evidence: AiStoredEvidenceContext;
}

export interface AiChatInput {
  context: AiContextEnvelope;
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
