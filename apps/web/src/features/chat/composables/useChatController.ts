import { ref, watch } from "vue";

import { fetchAiModelCatalog } from "../chatModelsApi";
import { AI_MODELS, DEFAULT_MODE, DEFAULT_MODEL, getModelForMode } from "../constants";
import { useChatAttachments } from "./useChatAttachments";
import { useChatExportImport } from "./useChatExportImport";
import { useChatSubmit } from "./useChatSubmit";
import { useStoredChats } from "./useStoredChats";
import { useChatMenus } from "./useChatMenus";
import type { QuickAction } from "../constants";
import type { Chat, AiModelOption } from "../types";

export function useChatController() {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const chatPendingDelete = ref<Chat | null>(null);
  const renamingChatId = ref<string | null>(null);
  const quickActionMode = ref<string | null>(null);
  const modelOptions = ref<AiModelOption[]>([...AI_MODELS]);
  const {
    clearSelectedAttachments,
    getAttachmentOnlyMessage,
    handleAttachmentsSelected,
    openAttachment,
    openSelectedAttachment,
    removeSelectedAttachment,
    selectedAttachments,
  } = useChatAttachments();

  const {
    activeChat,
    activeChatId,
    activeMessages,
    addChatAndSelect,
    chats,
    deleteChat: deleteStoredChat,
    ensureActiveChat,
    renameChat: renameStoredChat,
    replaceChats,
    selectChat: selectStoredChat,
    setChatStorageOwner,
    startNewChat: startStoredNewChat,
    updateChat,
  } = useStoredChats({
    clearSelectedAttachments,
    messageInput,
    selectedMode,
    selectedModel,
  });

  const {
    closeChatMenus,
    openChatMenu,
    openChatMenuForChat,
    openExportMenu,
    openExportMenuChat,
    openExportSubmenu,
    openMenuChat,
  } = useChatMenus(chats);
  const {
    copyAnswer,
    exportActiveChat,
    exportAnswer,
    exportChat,
    handleImportChat,
  } = useChatExportImport({
    activeChat,
    addChatAndSelect,
    closeChatMenus,
  });
  const {
    clearGuestLimitReached,
    guestLimitReached,
    handleSubmit,
    isSending,
    usageSummary,
  } = useChatSubmit({
    clearSelectedAttachments,
    ensureActiveChat,
    getAttachmentOnlyMessage,
    messageInput,
    modelOptions,
    quickActionMode,
    selectedAttachments,
    selectedMode,
    selectedModel,
    updateChat,
  });

  function syncModelForSelectedMode() {
    const nextModel = getModelForMode(selectedMode.value, selectedModel.value, modelOptions.value);

    if (selectedModel.value !== nextModel) {
      selectedModel.value = nextModel;
    }
  }

  watch(selectedMode, syncModelForSelectedMode);
  watch(selectedModel, syncModelForSelectedMode);

  async function loadAiModelCatalog() {
    try {
      modelOptions.value = await fetchAiModelCatalog();
      syncModelForSelectedMode();
    } catch {
      modelOptions.value = [...AI_MODELS];
    }
  }

  function selectChat(chatId: string) {
    selectStoredChat(chatId);
    renamingChatId.value = null;
    closeChatMenus();
  }

  function startNewChat() {
    startStoredNewChat();
    renamingChatId.value = null;
    closeChatMenus();
  }

  function requestDeleteChat(chatId: string) {
    const chat = chats.value.find((item) => item.id === chatId) || null;

    chatPendingDelete.value = chat;
    renamingChatId.value = null;
    closeChatMenus();
  }

  function cancelDeleteChat() {
    chatPendingDelete.value = null;
  }

  function confirmDeleteChat() {
    if (!chatPendingDelete.value) return;

    deleteStoredChat(chatPendingDelete.value.id);
    chatPendingDelete.value = null;
    renamingChatId.value = null;
    closeChatMenus();
  }

  function beginRenameChat(chat: Chat) {
    renamingChatId.value = chat.id;
    closeChatMenus();
  }

  function cancelRenameChat() {
    renamingChatId.value = null;
  }

  function submitRenameChat(chatId: string, title: string) {
    renameStoredChat(chatId, title);
    renamingChatId.value = null;
    closeChatMenus();
  }

  function applyQuickAction(action: QuickAction) {
    selectedMode.value = action.mode;
    messageInput.value = action.prompt;
    quickActionMode.value = action.mode;
  }

  return {
    activeChatId,
    activeMessages,
    applyQuickAction,
    beginRenameChat,
    cancelDeleteChat,
    cancelRenameChat,
    chatPendingDelete,
    chats,
    clearGuestLimitReached,
    confirmDeleteChat,
    copyAnswer,
    exportActiveChat,
    exportAnswer,
    exportChat,
    handleAttachmentsSelected,
    handleImportChat,
    handleSubmit,
    guestLimitReached,
    isSending,
    loadAiModelCatalog,
    messageInput,
    modelOptions,
    openAttachment,
    openChatMenu,
    openChatMenuForChat,
    openExportMenu,
    openExportMenuChat,
    openExportSubmenu,
    openMenuChat,
    openSelectedAttachment,
    renamingChatId,
    requestDeleteChat,
    replaceChats,
    removeSelectedAttachment,
    selectChat,
    selectedAttachments,
    selectedMode,
    selectedModel,
    setChatStorageOwner,
    usageSummary,
    submitRenameChat,
    startNewChat,
  };
}
