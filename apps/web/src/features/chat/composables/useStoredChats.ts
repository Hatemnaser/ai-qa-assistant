import { computed, ref } from "vue";
import type { Ref } from "vue";

import {
  clearActiveChatId,
  createChat,
  getActiveChatId,
  loadChats,
  saveChats,
  setActiveChatId,
} from "../chatStorage";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../constants";
import type { Chat } from "../types";

interface StoredChatOptions {
  clearSelectedImage: () => void;
  messageInput: Ref<string>;
  selectedMode: Ref<string>;
  selectedModel: Ref<string>;
}

export function useStoredChats({
  clearSelectedImage,
  messageInput,
  selectedMode,
  selectedModel,
}: StoredChatOptions) {
  const chats = ref<Chat[]>(loadChats());
  const activeChatId = ref(getActiveChatId());
  const activeChat = computed(() => chats.value.find((chat) => chat.id === activeChatId.value) || null);
  const activeMessages = computed(() => activeChat.value?.messages || []);

  function persist(nextChats = chats.value) {
    chats.value = nextChats;
    saveChats(chats.value);
  }

  function startNewChat() {
    activeChatId.value = null;
    clearActiveChatId();
    messageInput.value = "";
    clearSelectedImage();
    selectedMode.value = DEFAULT_MODE;
    selectedModel.value = DEFAULT_MODEL;
  }

  function selectChat(chatId: string) {
    const chat = chats.value.find((item) => item.id === chatId);

    if (!chat) return null;

    activeChatId.value = chat.id;
    setActiveChatId(chat.id);
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
      setActiveChatId(nextActiveChat.id);
      selectChat(nextActiveChat.id);
    } else {
      clearActiveChatId();
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

  return {
    activeChat,
    activeChatId,
    activeMessages,
    addChatAndSelect,
    chats,
    deleteChat,
    ensureActiveChat,
    renameChat,
    selectChat,
    startNewChat,
    updateChat,
  };
}
