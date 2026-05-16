export type AiRole = "user" | "assistant";

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
  history: AiHistoryMessage[];
  image?: AiImage;
}

export interface AiChatResponse {
  reply: string;
  model: string;
}

export interface AiErrorDetails {
  code?: string | number;
  httpStatus?: number;
  message: string;
  status?: string;
}
