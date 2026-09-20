import { ref, watch } from "vue";
import type { Ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { fetchAiModelCatalog } from "../chatModelsApi";
import { AI_MODELS, DEFAULT_MODE, DEFAULT_MODEL, getModelForMode } from "../constants";
import { useI18n } from "../../../i18n/useI18n";
import { useChatAttachments } from "./useChatAttachments";
import { useChatExportImport } from "./useChatExportImport";
import { useChatSubmit } from "./useChatSubmit";
import { useStoredChats } from "./useStoredChats";
import { useChatMenus } from "./useChatMenus";
import type { QuickAction } from "../constants";
import type { Chat, AiModelOption, SelectedAttachment } from "../types";

export function useChatController(currentUser: Ref<AuthUser | null>) {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const selectedProjectId = ref<string | null>(null);
  const chatPendingDelete = ref<Chat | null>(null);
  const renamingChatId = ref<string | null>(null);
  const quickActionMode = ref<string | null>(null);
  const modelOptions = ref<AiModelOption[]>([...AI_MODELS]);
  const selectedAttachments = ref<SelectedAttachment[]>([]);
  let identityRevision = 0;
  const getIdentity = () => `${identityRevision}:${currentUser.value?.id || "guest"}`;
  const { t } = useI18n();

  const {
    activeChat,
    activeChatId,
    activeMessages,
    addChatAndSelect,
    assignActiveChatProject,
    assignChatProject: assignStoredChatProject,
    chats,
    captureSubmission,
    deleteChat: deleteStoredChat,
    drafts,
    ensureActiveChat,
    prepareNewChatForProject,
    prepareNewChat,
    renameChat: renameStoredChat,
    replaceChats,
    selectChat: selectStoredChat,
    setChatStorageOwner,
    startNewChat: startStoredNewChat,
    updateChat,
  } = useStoredChats({
    messageInput,
    quickActionMode,
    selectedAttachments,
    selectedMode,
    selectedModel,
    selectedProjectId,
  });

  const {
    getAttachmentOnlyMessage,
    handleAttachmentsSelected,
    openAttachment,
    openSelectedAttachment,
    removeSelectedAttachment,
  } = useChatAttachments({ drafts, selectedAttachments, getIdentity });

  const {
    closeChatMenus,
    openChatMenu,
    openChatMenuForChat,
    openExportMenu,
    openExportMenuChat,
    openExportSubmenu,
    openMenuChat,
    openProjectMenu,
    openProjectMenuChat,
    openProjectSubmenu,
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
    getIdentity,
  });
  const {
    clearGuestLimitReached,
    guestLimitReached,
    handleSubmit,
    isSending,
    sendingChatId,
    usageSummary,
  } = useChatSubmit({
    captureSubmission,
    ensureActiveChat,
    getAttachmentOnlyMessage,
    getIdentity,
    isAuthenticated: () => Boolean(currentUser.value),
    messageInput,
    modelOptions,
    quickActionMode,
    selectedAttachments,
    selectedMode,
    selectedModel,
    updateChat,
  });

  watch(() => currentUser.value?.id || null, () => {
    identityRevision += 1;
    drafts.setDefaultModel(DEFAULT_MODEL);
    sendingChatId.value = null;
    usageSummary.value = null;
    clearGuestLimitReached();
  }, { flush: "sync" });

  function syncModelForSelectedMode() {
    const nextModel = getModelForMode(selectedMode.value, selectedModel.value, modelOptions.value);

    if (selectedModel.value !== nextModel) {
      selectedModel.value = nextModel;
    }
  }

  watch(selectedMode, syncModelForSelectedMode, { flush: "sync" });
  watch(selectedModel, syncModelForSelectedMode, { flush: "sync" });

  async function loadAiModelCatalog() {
    try {
      modelOptions.value = await fetchAiModelCatalog();
      syncModelForSelectedMode();
    } catch {
      modelOptions.value = [...AI_MODELS];
    }
  }

  function setDefaultModel(model: string) {
    // Changing account preferences seeds future drafts only; existing drafts keep
    // their own model selection and Visual Review still enforces compatibility.
    drafts.setDefaultModel(getModelForMode(DEFAULT_MODE, model, modelOptions.value));
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

  function assignChatProject(chatId: string, projectId: string | null) {
    assignStoredChatProject(chatId, projectId);
    closeChatMenus();
  }

  function applyQuickAction(action: QuickAction) {
    selectedMode.value = action.mode;
    if (!messageInput.value.trim()) messageInput.value = t(action.promptKey) || action.prompt;
    quickActionMode.value = action.mode;
  }

  return {
    activeChat,
    activeChatId,
    activeMessages,
    applyQuickAction,
    assignActiveChatProject,
    assignChatProject,
    beginRenameChat,
    cancelDeleteChat,
    cancelRenameChat,
    chatPendingDelete,
    chats,
    closeChatMenus,
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
    sendingChatId,
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
    openProjectMenu,
    openProjectMenuChat,
    openProjectSubmenu,
    openSelectedAttachment,
    prepareNewChatForProject,
    prepareNewChat,
    renamingChatId,
    requestDeleteChat,
    replaceChats,
    removeSelectedAttachment,
    selectChat,
    selectedAttachments,
    selectedMode,
    selectedModel,
    selectedProjectId,
    setDefaultModel,
    setChatStorageOwner,
    usageSummary,
    submitRenameChat,
    startNewChat,
  };
}
