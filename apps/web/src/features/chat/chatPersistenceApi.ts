import { getBackendError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { sanitizeChatForExport } from "./chatExportFormatters";
import type { Chat } from "./types";

export async function fetchAccountChats(): Promise<Chat[]> {
  const response = await csrfFetch(`${API_BASE_URL}/api/chats`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getBackendError(response, "Could not load saved chats."));
  }

  const body = (await response.json()) as { chats?: Chat[] };

  return Array.isArray(body.chats) ? body.chats : [];
}

export async function saveAccountChat(chat: Chat): Promise<Chat> {
  const chatForPersistence = sanitizeChatForExport(chat);
  const response = await csrfFetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chat.id)}`, {
    body: JSON.stringify({ chat: chatForPersistence }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(await getBackendError(response, "Could not save this chat."));
  }

  const body = (await response.json()) as { chat?: Chat };

  return body.chat || chat;
}

export async function deleteAccountChat(chatId: string) {
  const response = await csrfFetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`, {
    credentials: "include",
    method: "DELETE",
  });

  // Deletes are idempotent for durable local tombstones: another device may
  // already have removed the server row before this client reconnects.
  if (!response.ok && response.status !== 404) {
    throw new Error(await getBackendError(response, "Could not delete this saved chat."));
  }
}
