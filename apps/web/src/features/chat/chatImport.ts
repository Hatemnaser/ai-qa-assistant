import { DEFAULT_MODE, getModelForMode, normalizeModel } from "./constants";
import { createChat, createId } from "./chatStorage";
import type { Chat, ChatMessage } from "./types";

const CHAT_TYPE = "qa-chat";

export function parseImportedChatJson(rawJson: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid JSON file. Please choose a valid exported chat JSON file.");
  }

  const payload = parsed as { type?: string; chat?: Partial<Chat> };
  const chat = payload?.type === CHAT_TYPE ? payload.chat : parsed;

  if (!isImportableChat(chat)) {
    throw new Error("Invalid chat file. The JSON does not contain a chat object.");
  }

  if (!Array.isArray(chat.messages)) {
    throw new Error("Invalid chat file. The chat must include a messages array.");
  }

  return createChat({
    id: createId(),
    title: getImportedTitle(chat.title),
    mode: getMode(chat.mode),
    model: getModelForMode(getMode(chat.mode), chat.model),
    createdAt: isValidDate(chat.createdAt) ? chat.createdAt : new Date().toISOString(),
    updatedAt: isValidDate(chat.updatedAt) ? chat.updatedAt : new Date().toISOString(),
    messages: chat.messages.map(normalizeImportedMessage),
  });
}

function getImportedTitle(title: unknown) {
  return typeof title === "string" && title.trim()
    ? title.trim().slice(0, 50)
    : "Imported QA Chat";
}

function isImportableChat(value: unknown): value is Partial<Chat> & { messages: Partial<ChatMessage>[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as Partial<Chat>).messages)
  );
}

function normalizeImportedMessage(message: Partial<ChatMessage>): ChatMessage {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Invalid chat file. Every message must be an object.");
  }

  if (!["user", "assistant"].includes(String(message.role))) {
    throw new Error("Invalid chat file. Every message must have a user or assistant role.");
  }

  return {
    id: createId(),
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string" ? message.content : "",
    mode: getMode(message.mode),
    model: normalizeModel(message.model),
    createdAt: isValidDate(message.createdAt) ? message.createdAt : new Date().toISOString(),
    ...(message.attachment
      ? {
          attachment: {
            type: message.attachment.type === "image" ? "image" : "file",
            name: message.attachment.name || "Attachment",
            mimeType: message.attachment.mimeType || "",
          },
        }
      : {}),
  };
}

function getMode(mode: unknown) {
  return typeof mode === "string" && mode.trim() ? mode : DEFAULT_MODE;
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
