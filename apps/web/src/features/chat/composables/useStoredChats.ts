import { computed, ref } from "vue";
import type { Ref } from "vue";

import {
  clearActiveChatId,
  createChat,
  GUEST_CHAT_STORAGE_SCOPE,
  getActiveChatId,
  getUserChatStorageScope,
  loadChats,
  migrateGuestChatsToUser,
  saveChats,
  setActiveChatId,
} from "../chatStorage";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../constants";
import type { Chat } from "../types";

interface StoredChatOptions {
  clearSelectedAttachments: () => void;
  messageInput: Ref<string>;
  selectedMode: Ref<string>;
  selectedModel: Ref<string>;
}

export function useStoredChats({
  clearSelectedAttachments,
  messageInput,
  selectedMode,
  selectedModel,
}: StoredChatOptions) {
  const storageScope = ref(GUEST_CHAT_STORAGE_SCOPE);
  const chats = ref<Chat[]>(loadChats(storageScope.value));
  const activeChatId = ref(getActiveChatId(storageScope.value));
  const activeChat = computed(() => chats.value.find((chat) => chat.id === activeChatId.value) || null);
  const activeMessages = computed(() => activeChat.value?.messages || []);

  function persist(nextChats = chats.value) {
    chats.value = nextChats;
    saveChats(chats.value, storageScope.value);
  }

  function startNewChat() {
    activeChatId.value = null;
    clearActiveChatId(storageScope.value);
    messageInput.value = "";
    clearSelectedAttachments();
    selectedMode.value = DEFAULT_MODE;
    selectedModel.value = DEFAULT_MODEL;
  }

  function selectChat(chatId: string) {
    const chat = chats.value.find((item) => item.id === chatId);

    if (!chat) return null;

    activeChatId.value = chat.id;
    setActiveChatId(chat.id, storageScope.value);
    selectedMode.value = chat.mode;
    selectedModel.value = chat.model;

    return chat;
  }

  function deleteChat(chatId: string) {
    const nextChats = chats.value.filter((chat) => chat.id !== chatId);
    persist(nextChats);

    if (activeChatId.value !== chatId) return;

    const nextActiveChat = nextChats[0] || null;
    activeChatId.value = nextActiveChat?.id || null;

    if (nextActiveChat) {
      setActiveChatId(nextActiveChat.id, storageScope.value);
      selectChat(nextActiveChat.id);
    } else {
      clearActiveChatId(storageScope.value);
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

  function addChatAndSelect(chat: Chat) {
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
    });

    addChatAndSelect(chat);

    return chat;
  }

  function updateChat(updatedChat: Chat) {
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

    const currentActiveChatId = activeChatId.value;
    const nextActiveChat = chats.value.find((chat) => chat.id === currentActiveChatId) || chats.value[0] || null;

    activeChatId.value = nextActiveChat?.id || null;

    if (nextActiveChat) {
      setActiveChatId(nextActiveChat.id, storageScope.value);
    } else {
      clearActiveChatId(storageScope.value);
    }

    selectedMode.value = nextActiveChat?.mode || DEFAULT_MODE;
    selectedModel.value = nextActiveChat?.model || DEFAULT_MODEL;
  }

  function setChatStorageOwner(userId: string | null, options: { adoptGuestChats?: boolean } = {}) {
    if (userId && options.adoptGuestChats) {
      migrateGuestChatsToUser(userId);
    }

    storageScope.value = userId ? getUserChatStorageScope(userId) : GUEST_CHAT_STORAGE_SCOPE;
    chats.value = loadChats(storageScope.value);
    activeChatId.value = getActiveChatId(storageScope.value);
    messageInput.value = "";
    clearSelectedAttachments();

    if (!activeChat.value) {
      activeChatId.value = null;
      clearActiveChatId(storageScope.value);
    }

    selectedMode.value = activeChat.value?.mode || DEFAULT_MODE;
    selectedModel.value = activeChat.value?.model || DEFAULT_MODEL;
  }

  return {
    activeChat,
    activeChatId,
    activeMessages,
    addChatAndSelect,
    chats,
    deleteChat,
    ensureActiveChat,
    renameChat,
    replaceChats,
    selectChat,
    setChatStorageOwner,
    startNewChat,
    updateChat,
  };
}
