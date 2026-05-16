import { createId } from "./chatStorage";
import type { Chat, ChatAttachment, ChatHistoryItem, ChatMessage, SelectedImage } from "./types";

interface NewChatMessage {
  role: ChatMessage["role"];
  content: string;
  mode: string;
  model: string;
  attachment?: ChatAttachment;
}

export function createChatMessage({
  role,
  content,
  mode,
  model,
  attachment,
}: NewChatMessage): ChatMessage {
  return {
    id: createId(),
    role,
    content,
    mode,
    model,
    ...(attachment ? { attachment } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function buildRequestHistory(chat: Chat): ChatHistoryItem[] {
  return chat.messages
    .filter((message) => message.content.trim())
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
      mode: message.mode,
      model: message.model,
    }));
}

export function createImageAttachment(image: SelectedImage): ChatAttachment {
  return {
    type: "image",
    name: image.name,
    mimeType: image.mimeType,
    previewUrl: image.previewUrl,
  };
}
