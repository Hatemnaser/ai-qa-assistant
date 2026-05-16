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
  createdAt: string;
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
}

export interface RequestImage {
  mimeType: string;
  data: string;
}

export interface SelectedImage extends RequestImage {
  name: string;
  previewUrl: string;
}
