import { getCurrentInstance, onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { deleteAccountChat, fetchAccountChats, saveAccountChat } from "../chatPersistenceApi";
import {
  clearChatPendingDelete,
  clearChatPendingUpsert,
  getUserChatStorageScope,
  loadChatSyncState,
  markChatPendingDelete,
  mergeChatsByUpdatedAt,
} from "../chatStorage";
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
  let activeSync: Promise<void> | null = null;
  let activeSyncUserId: string | null = null;

  watch(
    chats,
    () => {
      if (!currentUser.value || isSyncingAccountChats.value) return;

      scheduleAccountChatPersist();
    },
    { deep: true }
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(clearScheduledChatPersist);
  }

  function syncAccountChats(): Promise<void> {
    const requestedUserId = currentUser.value?.id;

    if (!requestedUserId) return Promise.resolve();
    if (activeSync) {
      if (activeSyncUserId === requestedUserId) return activeSync;

      return activeSync.then(async () => {
        if (currentUser.value?.id === requestedUserId) {
          await syncAccountChats();
        }
      });
    }

    const sync = runAccountChatSync().finally(() => {
      if (activeSync === sync) {
        activeSync = null;
        activeSyncUserId = null;
      }
    });
    activeSync = sync;
    activeSyncUserId = requestedUserId;

    return sync;
  }

  async function runAccountChatSync() {
    const userId = currentUser.value?.id;

    if (!userId) return;

    const scope = getUserChatStorageScope(userId);
    const failedUpserts = new Set<string>();
    const processedUpserts = new Set<string>();
    let retryForConcurrentChange = false;
    isSyncingAccountChats.value = true;

    try {
      const accountChats = await fetchAccountChats();

      if (!isCurrentUser(userId)) return;

      const serverChatsById = new Map(accountChats.map((chat) => [chat.id, chat] as const));
      const pendingDeletes = loadChatSyncState(scope).pendingDeletes;

      for (const chatId of pendingDeletes) {
        try {
          await deleteAccountChat(chatId);
          clearChatPendingDelete(chatId, scope);
        } catch (error) {
          logSyncWarning(error, "Could not delete saved chat.");
        } finally {
          // A durable local tombstone hides the chat until the server confirms
          // deletion, so an old server snapshot cannot resurrect it.
          serverChatsById.delete(chatId);
        }
      }

      if (!isCurrentUser(userId)) return;

      const pendingState = loadChatSyncState(scope);
      const pendingCreateIds = new Set(pendingState.pendingCreates);
      const pendingMutationIds = [
        ...pendingState.pendingCreates,
        ...pendingState.pendingUpserts,
      ];
      const localChatsToPersist = selectLocalChatsToPersist(
        chats.value,
        pendingMutationIds
      );

      for (const chatId of pendingMutationIds) {
        if (localChatsToPersist.some((chat) => chat.id === chatId)) continue;

        processedUpserts.add(chatId);
        clearChatPendingUpsert(chatId, scope);
      }

      for (const candidate of localChatsToPersist) {
        processedUpserts.add(candidate.id);
        const currentCandidate = chats.value.find((chat) => chat.id === candidate.id);

        if (!currentCandidate) {
          clearChatPendingUpsert(candidate.id, scope);
          continue;
        }

        const serverChat = serverChatsById.get(candidate.id);
        if (!serverChat && !pendingCreateIds.has(candidate.id)) {
          // An update can never recreate a missing server row. A delete made
          // elsewhere wins over an offline edit from this cache.
          clearChatPendingUpsert(candidate.id, scope);
          continue;
        }
        if (serverChat && getTimestamp(serverChat.updatedAt) >= getTimestamp(currentCandidate.updatedAt)) {
          clearChatPendingUpsert(candidate.id, scope);
          continue;
        }

        try {
          const savedChat = await saveAccountChat(currentCandidate);
          serverChatsById.set(savedChat.id, savedChat);

          const latestLocal = chats.value.find((chat) => chat.id === currentCandidate.id);
          const latestState = loadChatSyncState(scope);
          const isStillPending =
            latestState.pendingCreates.includes(currentCandidate.id) ||
            latestState.pendingUpserts.includes(currentCandidate.id);
          if (
            latestLocal?.updatedAt === currentCandidate.updatedAt &&
            isStillPending
          ) {
            clearChatPendingUpsert(currentCandidate.id, scope);
          } else if (isStillPending) {
            retryForConcurrentChange = true;
          }
        } catch (error) {
          failedUpserts.add(currentCandidate.id);
          logSyncWarning(error, "Could not save chat.");
        }
      }

      if (!isCurrentUser(userId)) return;

      const finalState = loadChatSyncState(scope);
      const pendingDeleteIds = new Set(finalState.pendingDeletes);
      const pendingUpsertIds = new Set([
        ...finalState.pendingCreates,
        ...finalState.pendingUpserts,
      ]);
      const latestLocalPending = chats.value.filter(
        (chat) => pendingUpsertIds.has(chat.id) && !pendingDeleteIds.has(chat.id)
      );
      const finalServerChats = [...serverChatsById.values()].filter(
        (chat) => !pendingDeleteIds.has(chat.id)
      );

      if (
        [...finalState.pendingCreates, ...finalState.pendingUpserts].some(
          (chatId) => !processedUpserts.has(chatId) && !failedUpserts.has(chatId)
        )
      ) {
        retryForConcurrentChange = true;
      }

      // User-scoped localStorage is a cache. Only explicitly pending local
      // mutations participate in reconciliation; every other server omission
      // is authoritative (including a delete made on another device).
      replaceChats(mergeChatsByUpdatedAt([...finalServerChats, ...latestLocalPending]));
    } catch (error) {
      logSyncWarning(error, "Could not sync saved chats.");
    } finally {
      isSyncingAccountChats.value = false;

      if (retryForConcurrentChange && isCurrentUser(userId)) {
        scheduleAccountChatPersist();
      }
    }
  }

  async function persistAccountChats() {
    await syncAccountChats();
  }

  async function deletePersistedChat(chatId: string | null | undefined) {
    const userId = currentUser.value?.id;

    if (!userId || !chatId) return;

    const scope = getUserChatStorageScope(userId);
    markChatPendingDelete(chatId, scope);

    try {
      await deleteAccountChat(chatId);
      clearChatPendingDelete(chatId, scope);
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

  function isCurrentUser(userId: string) {
    return currentUser.value?.id === userId;
  }

  return {
    clearScheduledChatPersist,
    deletePersistedChat,
    isSyncingAccountChats,
    persistAccountChats,
    syncAccountChats,
  };
}

export function selectLocalChatsToPersist(
  localChats: Chat[],
  pendingUpsertIds: Iterable<string> = []
) {
  const pendingIds = new Set(pendingUpsertIds);

  return localChats.filter((localChat) => pendingIds.has(localChat.id));
}

function logSyncWarning(error: unknown, fallback: string) {
  console.warn(error instanceof Error ? error.message : fallback);
}

function getTimestamp(value: string) {
  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}
