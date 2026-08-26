export type ChatRole = "user" | "assistant";
export type ExportFormat = "json" | "md" | "txt" | "csv";

export interface MenuPosition {
  chatId: string;
  left: number;
  top: number;
}

export interface ChatAttachment {
  assetId?: string;
  type: "image" | "file";
  name: string;
  mimeType: string;
  previewUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  mode: string;
  model: string;
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
  createdAt: string;
  isError?: boolean;
}

export interface Chat {
  id: string;
  projectId: string | null;
  title: string;
  mode: string;
  model: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatHistoryItem {
  role: ChatRole;
  content: string;
  mode: string;
  model: string;
}

export interface ChatApiResponse {
  reply: string;
  mode: string;
  model: string;
  modelRouting?: ChatModelRoutingSummary;
  provider?: string;
  usage?: ChatUsageSummary;
  workflow?: ChatWorkflowSummary;
}

export interface ChatModelRoutingSummary {
  reason: string;
  requestedModel: string;
  selectedModel: string;
  source: string;
}

export interface ChatUsageSummary {
  limit: number;
  remaining: number;
  unit?: "credits";
  used: number;
}

export interface ChatWorkflowSummary {
  confidence: number;
  effectiveMode: string;
  intent: string;
  language: string;
  source: string;
  shouldUseArtifactTemplate: boolean;
  shouldAskClarifyingQuestion: boolean;
}

export interface AiModelCapabilities {
  images: boolean;
  text: boolean;
  textAttachments: boolean;
}

export interface AiModelOption {
  capabilities: AiModelCapabilities;
  label: string;
  provider: string;
  recommendedFor: string;
  value: string;
}

export interface AiModelCatalogResponse {
  defaultModel: string;
  defaultProvider: string;
  models: AiModelOption[];
  providers: string[];
}

export interface RequestImage {
  mimeType: string;
  data: string;
}

export interface RequestImageAttachment extends RequestImage {
  type: "image";
  name?: string;
}

export interface RequestFileAttachment {
  type: "file";
  name?: string;
  mimeType: string;
  content: string;
}

export interface RequestStoredAssetAttachment {
  assetId: string;
}

export type RequestAttachment = RequestImageAttachment | RequestFileAttachment | RequestStoredAssetAttachment;

export interface SelectedAttachment {
  file: File;
  name: string;
  mimeType: string;
  previewUrl?: string;
  type: "image" | "file";
}
