import { onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { deleteAccountChat, fetchAccountChats, saveAccountChat } from "../chatPersistenceApi";
import { mergeChatsByUpdatedAt } from "../chatStorage";
import type { Chat } from "../types";

interface AccountChatSyncOptions {
  chats: Ref<Chat[]>;
  currentUser: Ref<AuthUser | null>;
  replaceChats: (chats: Chat[]) => void;
}

const CHAT_PERSIST_DEBOUNCE_MS = 700;

export function useAccountChatSync({ chats, currentUser, replaceChats }: AccountChatSyncOptions) {
  const isSyncingAccountChats = ref(false);
  let chatPersistTimer: ReturnType<typeof setTimeout> | null = null;

  watch(
    chats,
    () => {
      if (!currentUser.value || isSyncingAccountChats.value) return;

      scheduleAccountChatPersist();
    },
    { deep: true }
  );

  onBeforeUnmount(clearScheduledChatPersist);

  async function syncAccountChats() {
    if (!currentUser.value) return;

    const userId = currentUser.value.id;
    isSyncingAccountChats.value = true;

    try {
      const accountChats = await fetchAccountChats();

      if (!currentUser.value || currentUser.value.id !== userId) return;

      const mergedChats = mergeChatsByUpdatedAt([...chats.value, ...accountChats]);

      replaceChats(mergedChats);
      await saveChats(mergedChats);
    } catch (error) {
      logSyncWarning(error, "Could not sync saved chats.");
    } finally {
      isSyncingAccountChats.value = false;
    }
  }

  async function persistAccountChats() {
    if (!currentUser.value) return;

    try {
      await saveChats(chats.value);
    } catch (error) {
      logSyncWarning(error, "Could not save chats.");
    }
  }

  async function deletePersistedChat(chatId: string | null | undefined) {
    if (!currentUser.value || !chatId) return;

    try {
      await deleteAccountChat(chatId);
    } catch (error) {
      logSyncWarning(error, "Could not delete saved chat.");
    }
  }

  function scheduleAccountChatPersist() {
    clearScheduledChatPersist();

    chatPersistTimer = globalThis.setTimeout(() => {
      chatPersistTimer = null;
      void persistAccountChats();
    }, CHAT_PERSIST_DEBOUNCE_MS);
  }

  function clearScheduledChatPersist() {
    if (!chatPersistTimer) return;

    globalThis.clearTimeout(chatPersistTimer);
    chatPersistTimer = null;
  }

  return {
    clearScheduledChatPersist,
    deletePersistedChat,
    isSyncingAccountChats,
    persistAccountChats,
    syncAccountChats,
  };
}

async function saveChats(chats: Chat[]) {
  await Promise.all(chats.map((chat) => saveAccountChat(chat)));
}

function logSyncWarning(error: unknown, fallback: string) {
  console.warn(error instanceof Error ? error.message : fallback);
}
