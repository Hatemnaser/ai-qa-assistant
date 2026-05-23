import { createId } from "./chatStorage";
import type { Chat, ChatAttachment, ChatHistoryItem, ChatMessage } from "./types";

interface NewChatMessage {
  role: ChatMessage["role"];
  content: string;
  mode: string;
  model: string;
  attachment?: ChatAttachment;
  isError?: boolean;
}

export function createChatMessage({
  role,
  content,
  mode,
  model,
  attachment,
  isError,
}: NewChatMessage): ChatMessage {
  return {
    id: createId(),
    role,
    content,
    mode,
    model,
    ...(attachment ? { attachment } : {}),
    ...(isError ? { isError } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function buildRequestHistory(chat: Chat): ChatHistoryItem[] {
  return chat.messages
    .filter((message) => message.content.trim() && !shouldExcludeFromHistory(message))
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
      mode: message.mode,
      model: message.model,
    }));
}

function shouldExcludeFromHistory(message: ChatMessage) {
  if (message.isError) return true;

  return message.role === "assistant" && systemErrorPatterns.some((pattern) => pattern.test(message.content));
}

const systemErrorPatterns = [
  /daily (demo )?limit reached/i,
  /message limit reached/i,
  /gemini quota exceeded/i,
  /temporarily overloaded/i,
  /could not connect to the backend/i,
  /backend took too long/i,
  /invalid request payload/i,
  /gemini_api_key is not configured/i,
];
