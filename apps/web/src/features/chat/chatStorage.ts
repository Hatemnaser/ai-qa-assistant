import { DEFAULT_MODE, STORAGE_KEYS, getModelForMode, normalizeModel } from "./constants";
import type { Chat, ChatAttachment } from "./types";

export const GUEST_CHAT_STORAGE_SCOPE = "guest";

export function getUserChatStorageScope(userId: string) {
  return `user:${userId}`;
}

export function loadChats(scope = GUEST_CHAT_STORAGE_SCOPE) {
  const savedChats = localStorage.getItem(getScopedStorageKey(STORAGE_KEYS.CHATS, scope));
  const chats = parseSavedChats(savedChats);

  return Array.isArray(chats) ? chats.map(normalizeChat) : [];
}

export function saveChats(chats: Chat[], scope = GUEST_CHAT_STORAGE_SCOPE) {
  localStorage.setItem(getScopedStorageKey(STORAGE_KEYS.CHATS, scope), JSON.stringify(chats));
}

export function getActiveChatId(scope = GUEST_CHAT_STORAGE_SCOPE) {
  return localStorage.getItem(getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope));
}

export function setActiveChatId(chatId: string, scope = GUEST_CHAT_STORAGE_SCOPE) {
  localStorage.setItem(getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope), chatId);
}

export function clearActiveChatId(scope = GUEST_CHAT_STORAGE_SCOPE) {
  localStorage.removeItem(getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope));
}

export function clearChats(scope = GUEST_CHAT_STORAGE_SCOPE) {
  localStorage.removeItem(getScopedStorageKey(STORAGE_KEYS.CHATS, scope));
  clearActiveChatId(scope);
}

export function mergeChatsByUpdatedAt(chats: Chat[]) {
  const chatsById = new Map<string, Chat>();

  for (const chat of chats) {
    const existingChat = chatsById.get(chat.id);

    if (!existingChat || getTimestamp(chat.updatedAt) >= getTimestamp(existingChat.updatedAt)) {
      chatsById.set(chat.id, chat);
    }
  }

  return Array.from(chatsById.values()).sort(
    (first, second) => getTimestamp(second.updatedAt) - getTimestamp(first.updatedAt)
  );
}

export function migrateGuestChatsToUser(userId: string) {
  const userScope = getUserChatStorageScope(userId);
  const guestChats = loadChats(GUEST_CHAT_STORAGE_SCOPE);

  if (guestChats.length === 0) return false;

  const userChats = loadChats(userScope);
  const existingIds = new Set(userChats.map((chat) => chat.id));
  const mergedChats = [...guestChats.filter((chat) => !existingIds.has(chat.id)), ...userChats];
  const nextActiveChatId = getActiveChatId(GUEST_CHAT_STORAGE_SCOPE) || guestChats[0]?.id || mergedChats[0]?.id;

  saveChats(mergedChats, userScope);

  if (nextActiveChatId) {
    setActiveChatId(nextActiveChatId, userScope);
  }

  clearChats(GUEST_CHAT_STORAGE_SCOPE);

  return true;
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
      ? chat.messages.map((message) => {
          const attachments = normalizeAttachments(message);

          return {
            id: message.id || createId(),
            role: message.role === "assistant" ? "assistant" : "user",
            content: typeof message.content === "string" ? message.content : "",
            mode: message.mode || chat.mode || DEFAULT_MODE,
            model: normalizeModel(message.model || chat.model),
            ...(attachments.length > 0 ? { attachments } : {}),
            createdAt: message.createdAt || new Date().toISOString(),
            ...(message.isError ? { isError: true } : {}),
          };
        })
      : [],
  });
}

function normalizeAttachments(message: Partial<Chat["messages"][number]>) {
  const rawAttachments = Array.isArray(message.attachments)
    ? message.attachments
    : message.attachment
      ? [message.attachment]
      : [];

  return rawAttachments.filter(isAttachmentLike).map(normalizeAttachment);
}

function normalizeAttachment(attachment: Partial<ChatAttachment>): ChatAttachment {
  return {
    type: attachment.type === "image" ? "image" : "file",
    name: attachment.name || "Attachment",
    mimeType: attachment.mimeType || "",
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
}

function isAttachmentLike(value: unknown): value is Partial<ChatAttachment> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSavedChats(savedChats: string | null) {
  if (!savedChats) return [];

  try {
    return JSON.parse(savedChats);
  } catch {
    return [];
  }
}

function getScopedStorageKey(key: string, scope: string) {
  return scope === GUEST_CHAT_STORAGE_SCOPE ? key : `${key}:${scope}`;
}

function getTimestamp(value: string) {
  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}
