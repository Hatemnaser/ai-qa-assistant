import { computed, ref } from "vue";
import type { Ref } from "vue";

import {
  clearActiveChatId,
  createChat,
  discardVolatileChatCreates,
  GUEST_CHAT_STORAGE_SCOPE,
  getActiveChatId,
  getUserChatStorageScope,
  loadChats,
  markChatPendingCreate,
  markChatPendingDelete,
  markChatPendingUpsert,
  migrateGuestChatsToUser,
  saveChats,
  setActiveChatId,
} from "../chatStorage";
import type { Chat } from "../types";
import { useChatDrafts, type ChatDraftRefs } from "./useChatDrafts";

interface StoredChatOptions extends ChatDraftRefs {
  selectedProjectId: Ref<string | null>;
}

export function useStoredChats(options: StoredChatOptions) {
  const { selectedMode, selectedModel, selectedProjectId } = options;
  const drafts = useChatDrafts(options);
  let ownerRevision = 0;
  const storageScope = ref(GUEST_CHAT_STORAGE_SCOPE);
  const chats = ref<Chat[]>(loadChats(storageScope.value));
  const activeChatId = ref(getActiveChatId(storageScope.value));
  const activeChat = computed(() => chats.value.find((chat) => chat.id === activeChatId.value) || null);
  const activeMessages = computed(() => activeChat.value?.messages || []);
  if (activeChat.value) selectChat(activeChat.value.id);

  function persist(nextChats = chats.value) {
    chats.value = nextChats;
    saveChats(chats.value, storageScope.value);
  }

  function startNewChat() {
    prepareNewChatForProject(null);
  }

  function prepareNewChatForProject(projectId: string | null) {
    activeChatId.value = null;
    clearActiveChatId(storageScope.value);
    selectedProjectId.value = normalizeSelectedProjectId(projectId);
    drafts.select(`new:${selectedProjectId.value || ""}`);
  }

  function selectChat(chatId: string) {
    const chat = chats.value.find((item) => item.id === chatId);

    if (!chat) return null;

    activeChatId.value = chat.id;
    setActiveChatId(chat.id, storageScope.value);
    selectedProjectId.value = chat.projectId;
    drafts.select(`chat:${chat.id}`, { mode: chat.mode, model: chat.model });

    return chat;
  }

  function deleteChat(chatId: string) {
    const nextChats = chats.value.filter((chat) => chat.id !== chatId);
    markChatPendingDelete(chatId, storageScope.value);
    persist(nextChats);
    drafts.remove(`chat:${chatId}`);

    if (activeChatId.value !== chatId) return;

    const nextActiveChat = nextChats[0] || null;
    activeChatId.value = nextActiveChat?.id || null;

    if (nextActiveChat) {
      setActiveChatId(nextActiveChat.id, storageScope.value);
      selectChat(nextActiveChat.id);
    } else {
      startNewChat();
    }
  }

  function renameChat(chatId: string, title: string) {
    const chat = chats.value.find((item) => item.id === chatId);
    const nextTitle = title.trim();

    if (!chat || !nextTitle || nextTitle === chat.title) return;

    updateChat({
      ...chat,
      title: nextTitle.slice(0, 50),
    });
  }

  function assignActiveChatProject(projectId: string | null) {
    assignChatProject(activeChatId.value, projectId, { updateSelectedProject: true });
  }

  function assignChatProject(
    chatId: string | null,
    projectId: string | null,
    options: { updateSelectedProject?: boolean } = {}
  ) {
    const nextProjectId = normalizeSelectedProjectId(projectId);

    if (!chatId && options.updateSelectedProject) {
      prepareNewChatForProject(nextProjectId);
      return;
    }

    if (options.updateSelectedProject || activeChatId.value === chatId) {
      selectedProjectId.value = nextProjectId;
    }

    const chat = chats.value.find((item) => item.id === chatId);

    if (!chat || chat.projectId === nextProjectId) return;

    updateChat({
      ...chat,
      projectId: nextProjectId,
    });
  }

  function addChatAndSelect(chat: Chat) {
    markChatPendingCreate(chat.id, storageScope.value);
    persist([chat, ...chats.value]);
    selectChat(chat.id);
  }

  function ensureActiveChat() {
    if (activeChat.value) {
      return activeChat.value;
    }

    const chat = createChat({
      mode: selectedMode.value,
      model: selectedModel.value,
      projectId: selectedProjectId.value,
    });

    drafts.transferTo(`chat:${chat.id}`);
    addChatAndSelect(chat);

    return chat;
  }

  function updateChat(updatedChat: Chat) {
    if (!chats.value.some((chat) => chat.id === updatedChat.id)) return;
    markChatPendingUpsert(updatedChat.id, storageScope.value);
    persist(
      chats.value.map((chat) =>
        chat.id === updatedChat.id
          ? {
              ...updatedChat,
              updatedAt: new Date().toISOString(),
            }
          : chat
      )
    );
  }

  function replaceChats(nextChats: Chat[]) {
    persist(nextChats);
    drafts.retainChats(new Set(nextChats.map((chat) => chat.id)));

    const currentActiveChatId = activeChatId.value;
    if (!currentActiveChatId) return;
    const nextActiveChat = chats.value.find((chat) => chat.id === currentActiveChatId) || chats.value[0] || null;

    if (nextActiveChat) {
      selectChat(nextActiveChat.id);
    } else {
      startNewChat();
    }
  }

  function setChatStorageOwner(userId: string | null, options: { adoptGuestChats?: boolean } = {}) {
    if (userId && options.adoptGuestChats) {
      migrateGuestChatsToUser(userId);
    }

    const nextScope = userId ? getUserChatStorageScope(userId) : GUEST_CHAT_STORAGE_SCOPE;
    if (storageScope.value === nextScope) return;

    if (storageScope.value !== nextScope) {
      discardVolatileChatCreates(storageScope.value);
    }

    storageScope.value = nextScope;
    ownerRevision += 1;
    drafts.reset();
    chats.value = loadChats(storageScope.value);
    activeChatId.value = getActiveChatId(storageScope.value);

    if (!activeChat.value) {
      activeChatId.value = null;
      clearActiveChatId(storageScope.value);
    }

    if (activeChat.value) selectChat(activeChat.value.id);
    else startNewChat();
  }

  function captureSubmission(chatId: string) {
    const revision = ownerRevision;
    const ticket = drafts.capture();
    const getChat = () => revision === ownerRevision && ticket.entry.valid
      ? chats.value.find((chat) => chat.id === chatId) || null
      : null;
    return {
      getChat,
      isActive: () => Boolean(getChat()) && activeChatId.value === chatId,
      consumeDraft: (resetQuickAction: boolean) => {
        if (getChat()) drafts.consume(ticket, resetQuickAction);
      },
    };
  }

  return {
    activeChat,
    activeChatId,
    activeMessages,
    addChatAndSelect,
    assignActiveChatProject,
    assignChatProject,
    chats,
    captureSubmission,
    drafts,
    deleteChat,
    ensureActiveChat,
    renameChat,
    replaceChats,
    selectChat,
    setChatStorageOwner,
    prepareNewChatForProject,
    prepareNewChat: startNewChat,
    startNewChat,
    updateChat,
  };
}

function normalizeSelectedProjectId(projectId: string | null) {
  return typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
}
