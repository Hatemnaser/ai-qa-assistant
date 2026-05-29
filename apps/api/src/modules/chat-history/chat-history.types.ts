import type { z } from "zod";

import type { storedChatSchema } from "./chat-history.schema.js";

export type StoredChatInput = z.infer<typeof storedChatSchema>;

export interface StoredChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string;
  model: string;
  attachment?: unknown;
  attachments?: unknown[];
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
