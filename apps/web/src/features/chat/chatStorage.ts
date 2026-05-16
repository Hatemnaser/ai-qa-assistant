import { DEFAULT_MODE, STORAGE_KEYS, getModelForMode, normalizeModel } from "./constants";
import type { Chat, ChatAttachment } from "./types";

export function loadChats() {
  const savedChats = localStorage.getItem(STORAGE_KEYS.CHATS);
  const chats = parseSavedChats(savedChats);

  return Array.isArray(chats) ? chats.map(normalizeChat) : [];
}

export function saveChats(chats: Chat[]) {
  localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
}

export function getActiveChatId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAT_ID);
}

export function setActiveChatId(chatId: string) {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_CHAT_ID, chatId);
}

export function clearActiveChatId() {
  localStorage.removeItem(STORAGE_KEYS.ACTIVE_CHAT_ID);
}

export function createChat(settings: Partial<Chat> = {}): Chat {
  const now = new Date().toISOString();

  return {
    id: settings.id || createId(),
    title: settings.title || "New QA Chat",
    mode: settings.mode || DEFAULT_MODE,
    model: getModelForMode(settings.mode || DEFAULT_MODE, settings.model),
    messages: Array.isArray(settings.messages) ? settings.messages : [],
    createdAt: settings.createdAt || now,
    updatedAt: settings.updatedAt || now,
  };
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function normalizeChat(chat: Partial<Chat>): Chat {
  return createChat({
    ...chat,
    messages: Array.isArray(chat.messages)
      ? chat.messages.map((message) => ({
          id: message.id || createId(),
          role: message.role === "assistant" ? "assistant" : "user",
          content: typeof message.content === "string" ? message.content : "",
          mode: message.mode || chat.mode || DEFAULT_MODE,
          model: normalizeModel(message.model || chat.model),
          ...(message.attachment ? { attachment: normalizeAttachment(message.attachment) } : {}),
          createdAt: message.createdAt || new Date().toISOString(),
        }))
      : [],
  });
}

function normalizeAttachment(attachment: Partial<ChatAttachment>): ChatAttachment {
  return {
    type: attachment.type === "image" ? "image" : "file",
    name: attachment.name || "Attachment",
    mimeType: attachment.mimeType || "",
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
}

function parseSavedChats(savedChats: string | null) {
  if (!savedChats) return [];

  try {
    return JSON.parse(savedChats);
  } catch {
    return [];
  }
}
