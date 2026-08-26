import type { z } from "zod";

import type { storedChatSchema } from "./chat-history.schema.js";

export type StoredChatInput = z.infer<typeof storedChatSchema>;

export type StoredMessageRole = "USER" | "ASSISTANT" | "SYSTEM";

export interface StoredMessageAttachmentRecord {
  assetId: string;
  ordinal: number;
  asset: {
    id: string;
    declaredMimeType: string;
    detectedMimeType: string | null;
    originalName: string;
    sizeBytes: number | null;
  };
}

export interface StoredMessageRecord {
  id: string;
  role: StoredMessageRole;
  content: string;
  mode: string;
  model: string | null;
  attachment: unknown;
  metadata: unknown;
  createdAt: Date;
  attachments?: StoredMessageAttachmentRecord[];
}

export interface StoredChatRecord {
  id: string;
  projectId: string | null;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: StoredMessageRecord[];
}

export interface SaveUserChatInput {
  chat: StoredChatInput;
  createdAt: Date;
  messages: Array<{
    id: string;
    role: StoredMessageRole;
    content: string;
    mode: string;
    model: string;
    attachment?: unknown;
    assetAttachments: Array<{
      assetId: string;
      ordinal: number;
    }>;
    metadata?: unknown;
    createdAt: Date;
  }>;
  updatedAt: Date;
  userId: string;
}

export interface ChatHistoryRepository {
  deleteUserChat(userId: string, chatId: string): Promise<number>;
  findChatOwner(chatId: string): Promise<{ userId: string } | null>;
  findChatByIdAndUserId(chatId: string, userId: string): Promise<StoredChatRecord | null>;
  listUserChats(userId: string): Promise<StoredChatRecord[]>;
  saveUserChat(input: SaveUserChatInput): Promise<StoredChatRecord>;
}

export interface StoredChatAttachmentDto {
  assetId?: string;
  type: "image" | "file";
  name: string;
  mimeType: string;
}

export interface StoredChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string;
  model: string;
  attachment?: unknown;
  attachments?: StoredChatAttachmentDto[];
  createdAt: string;
  isError?: boolean;
}

export interface StoredChatDto {
  id: string;
  projectId: string | null;
  title: string;
  mode: string;
  model: string;
  messages: StoredChatMessageDto[];
  createdAt: string;
  updatedAt: string;
}
