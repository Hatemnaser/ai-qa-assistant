import { DEFAULT_MODE, STORAGE_KEYS, getModelForMode, normalizeModel } from "./constants";
import type { Chat, ChatAttachment } from "./types";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../../lib/browserStorage";

export const GUEST_CHAT_STORAGE_SCOPE = "guest";
const MAX_PENDING_CHAT_MUTATIONS = 200;
const volatileChatSyncStates = new Map<string, ChatSyncState>();
const volatilePendingChatCreates = new Map<string, string[]>();

export interface ChatSyncState {
  pendingCreates: string[];
  pendingDeletes: string[];
  pendingUpserts: string[];
}

export function getUserChatStorageScope(userId: string) {
  return `user:${userId}`;
}

export function loadChats(scope = GUEST_CHAT_STORAGE_SCOPE) {
  const savedChats = getLocalStorageItem(
    getScopedStorageKey(STORAGE_KEYS.CHATS, scope),
    null
  );
  const chats = parseSavedChats(savedChats);

  return Array.isArray(chats) ? chats.map(normalizeChat) : [];
}

export function saveChats(chats: Chat[], scope = GUEST_CHAT_STORAGE_SCOPE) {
  try {
    return setLocalStorageItem(
      getScopedStorageKey(STORAGE_KEYS.CHATS, scope),
      JSON.stringify(chats, (key, value) => (key === "previewUrl" ? undefined : value))
    );
  } catch {
    return false;
  }
}

export function getActiveChatId(scope = GUEST_CHAT_STORAGE_SCOPE) {
  return getLocalStorageItem(
    getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope),
    null
  );
}

export function setActiveChatId(chatId: string, scope = GUEST_CHAT_STORAGE_SCOPE) {
  return setLocalStorageItem(
    getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope),
    chatId
  );
}

export function clearActiveChatId(scope = GUEST_CHAT_STORAGE_SCOPE) {
  return removeLocalStorageItem(
    getScopedStorageKey(STORAGE_KEYS.ACTIVE_CHAT_ID, scope)
  );
}

export function clearChats(scope = GUEST_CHAT_STORAGE_SCOPE) {
  removeLocalStorageItem(getScopedStorageKey(STORAGE_KEYS.CHATS, scope));
  removeLocalStorageItem(getScopedStorageKey(STORAGE_KEYS.CHAT_SYNC_STATE, scope));
  volatileChatSyncStates.delete(scope);
  volatilePendingChatCreates.delete(scope);
  clearActiveChatId(scope);
}

export function loadChatSyncState(scope: string): ChatSyncState {
  if (!isUserStorageScope(scope)) return emptyChatSyncState();

  const volatileState = volatileChatSyncStates.get(scope);
  if (volatileState) {
    const pendingDeletes = [...volatileState.pendingDeletes];
    const deletedIds = new Set(pendingDeletes);

    return {
      pendingCreates: loadPendingCreates(scope).filter((id) => !deletedIds.has(id)),
      pendingDeletes,
      pendingUpserts: [...volatileState.pendingUpserts].filter((id) => !deletedIds.has(id)),
    };
  }

  const storedState = getLocalStorageItem(
    getScopedStorageKey(STORAGE_KEYS.CHAT_SYNC_STATE, scope),
    null
  );
  const parsed = parseSavedObject(storedState);

  const pendingDeletes = normalizePendingIds(parsed?.pendingDeletes);
  const deletedIds = new Set(pendingDeletes);

  return {
    pendingCreates: loadPendingCreates(scope).filter((id) => !deletedIds.has(id)),
    pendingDeletes,
    pendingUpserts: normalizePendingIds(parsed?.pendingUpserts).filter(
      (id) => !deletedIds.has(id)
    ),
  };
}

export function markChatPendingCreate(chatId: string, scope: string) {
  if (!isUserStorageScope(scope) || !chatId) return;

  const state = loadChatSyncState(scope);
  volatilePendingChatCreates.set(
    scope,
    appendUniqueId(state.pendingCreates, chatId)
  );
  writeChatSyncState(scope, {
    pendingCreates: loadPendingCreates(scope),
    pendingDeletes: state.pendingDeletes.filter((id) => id !== chatId),
    pendingUpserts: state.pendingUpserts.filter((id) => id !== chatId),
  });
}

export function markChatPendingUpsert(chatId: string, scope: string) {
  if (!isUserStorageScope(scope) || !chatId) return;

  const state = loadChatSyncState(scope);
  if (state.pendingCreates.includes(chatId)) return;

  writeChatSyncState(scope, {
    pendingCreates: state.pendingCreates,
    pendingDeletes: state.pendingDeletes.filter((id) => id !== chatId),
    pendingUpserts: appendUniqueId(state.pendingUpserts, chatId),
  });
}

export function markChatPendingDelete(chatId: string, scope: string) {
  if (!isUserStorageScope(scope) || !chatId) return;

  const state = loadChatSyncState(scope);
  removePendingCreate(chatId, scope);
  writeChatSyncState(scope, {
    pendingCreates: loadPendingCreates(scope),
    pendingDeletes: appendUniqueId(state.pendingDeletes, chatId),
    pendingUpserts: state.pendingUpserts.filter((id) => id !== chatId),
  });
}

export function clearChatPendingUpsert(chatId: string, scope: string) {
  const state = loadChatSyncState(scope);
  removePendingCreate(chatId, scope);
  writeChatSyncState(scope, {
    ...state,
    pendingCreates: loadPendingCreates(scope),
    pendingUpserts: state.pendingUpserts.filter((id) => id !== chatId),
  });
}

export function clearChatPendingDelete(chatId: string, scope: string) {
  const state = loadChatSyncState(scope);
  writeChatSyncState(scope, {
    ...state,
    pendingDeletes: state.pendingDeletes.filter((id) => id !== chatId),
  });
}

export function discardVolatileChatCreates(scope: string) {
  volatilePendingChatCreates.delete(scope);
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
  const migratedGuestChats = guestChats.filter((chat) => !existingIds.has(chat.id));
  const mergedChats = [...migratedGuestChats, ...userChats];
  const nextActiveChatId = getActiveChatId(GUEST_CHAT_STORAGE_SCOPE) || guestChats[0]?.id || mergedChats[0]?.id;

  saveChats(mergedChats, userScope);
  for (const guestChat of migratedGuestChats) {
    markChatPendingCreate(guestChat.id, userScope);
  }

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
    projectId: normalizeProjectId(settings.projectId),
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

function normalizeProjectId(projectId: unknown) {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
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
    ...(typeof attachment.assetId === "string" && attachment.assetId.trim()
      ? { assetId: attachment.assetId.trim() }
      : {}),
    type: attachment.type === "image" ? "image" : "file",
    name: attachment.name || "Attachment",
    mimeType: attachment.mimeType || "",
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

function parseSavedObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizePendingIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 191)
  )].slice(-MAX_PENDING_CHAT_MUTATIONS);
}

function appendUniqueId(ids: string[], chatId: string) {
  return [...ids.filter((id) => id !== chatId), chatId].slice(-MAX_PENDING_CHAT_MUTATIONS);
}

function writeChatSyncState(scope: string, state: ChatSyncState) {
  if (!isUserStorageScope(scope)) return;

  const normalized = {
    pendingCreates: [] as string[],
    pendingDeletes: normalizePendingIds(state.pendingDeletes),
    pendingUpserts: normalizePendingIds(state.pendingUpserts),
  };
  const storageKey = getScopedStorageKey(STORAGE_KEYS.CHAT_SYNC_STATE, scope);

  if (normalized.pendingDeletes.length === 0 && normalized.pendingUpserts.length === 0) {
    if (removeLocalStorageItem(storageKey)) {
      volatileChatSyncStates.delete(scope);
    } else {
      volatileChatSyncStates.set(scope, normalized);
    }
    return;
  }

  if (setLocalStorageItem(storageKey, JSON.stringify(normalized))) {
    volatileChatSyncStates.delete(scope);
  } else {
    // Keep explicit mutations safe for the current page even when browser
    // storage is unavailable. The fallback intentionally cannot survive reload.
    volatileChatSyncStates.set(scope, normalized);
  }
}

function emptyChatSyncState(): ChatSyncState {
  return { pendingCreates: [], pendingDeletes: [], pendingUpserts: [] };
}

function loadPendingCreates(scope: string) {
  return [...(volatilePendingChatCreates.get(scope) || [])];
}

function removePendingCreate(chatId: string, scope: string) {
  const nextIds = loadPendingCreates(scope).filter((id) => id !== chatId);

  if (nextIds.length > 0) {
    volatilePendingChatCreates.set(scope, nextIds);
  } else {
    volatilePendingChatCreates.delete(scope);
  }
}

function isUserStorageScope(scope: string) {
  return scope.startsWith("user:");
}

function getScopedStorageKey(key: string, scope: string) {
  return scope === GUEST_CHAT_STORAGE_SCOPE ? key : `${key}:${scope}`;
}

function getTimestamp(value: string) {
  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}
