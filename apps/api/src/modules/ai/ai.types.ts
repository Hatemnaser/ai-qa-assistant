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

export interface AiChatInput {
  message: string;
  mode: string;
  model?: string;
  provider?: string;
  history: AiHistoryMessage[];
  image?: AiImage;
}

export interface AiChatResponse {
  reply: string;
  model: string;
  provider?: string;
}

export interface AiErrorDetails {
  code?: string | number;
  httpStatus?: number;
  message: string;
  status?: string;
}

export interface AiModelConfig {
  label: string;
  provider: AiProviderId;
  recommendedFor: string;
  supportsImages: boolean;
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
