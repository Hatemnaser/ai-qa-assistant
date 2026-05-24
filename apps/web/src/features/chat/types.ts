export type ChatRole = "user" | "assistant";
export type ExportFormat = "json" | "md" | "txt" | "csv";

export interface MenuPosition {
  chatId: string;
  left: number;
  top: number;
}

export interface ChatAttachment {
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
  provider?: string;
  usage?: ChatUsageSummary;
}

export interface ChatUsageSummary {
  limit: number;
  remaining: number;
  used: number;
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

export type RequestAttachment = RequestImageAttachment | RequestFileAttachment;

export type SelectedAttachment = RequestAttachment & {
  name: string;
  previewUrl?: string;
};
