import { nextTick, ref, watch } from "vue";

import { ChatApiError, sendMessageToAI } from "../chatApi";
import {
  exportAnswerByFormat,
  exportChatByFormat,
  parseImportedChatJson,
} from "../chatExport";
import { createAttachments, createRequestAttachments } from "../chatAttachments";
import { buildRequestHistory, createChatMessage } from "../chatMessages";
import { fetchAiModelCatalog } from "../chatModelsApi";
import { AI_MODELS, DEFAULT_MODE, DEFAULT_MODEL, getModelForMode } from "../constants";
import { useChatAttachments } from "./useChatAttachments";
import { useStoredChats } from "./useStoredChats";
import { useChatMenus } from "./useChatMenus";
import type { QuickAction } from "../constants";
import type {
  Chat,
  ChatMessage,
  ChatUsageSummary,
  AiModelOption,
  ExportFormat,
} from "../types";

export function useChatController() {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const chatPendingDelete = ref<Chat | null>(null);
  const renamingChatId = ref<string | null>(null);
  const quickActionMode = ref<string | null>(null);
  const usageSummary = ref<ChatUsageSummary | null>(null);
  const guestLimitReached = ref(false);
  const isSending = ref(false);
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

  function exportActiveChat(format: ExportFormat = "json") {
    if (!activeChat.value) {
      alert("There is no active chat to export.");
      return;
    }

    exportChat(activeChat.value, format);
  }

  function exportChat(chat: Chat, format: ExportFormat) {
    exportChatByFormat(chat, format);
    closeChatMenus();
  }

  async function handleImportChat(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = "";

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      alert("Please choose a JSON chat export file.");
      return;
    }

    try {
      const importedChat = parseImportedChatJson(await file.text());
      addChatAndSelect(importedChat);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not import this chat JSON file.");
    }
  }

  function exportAnswer(message: ChatMessage, format: ExportFormat) {
    exportAnswerByFormat(message, format);
  }

  async function copyAnswer(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      alert("Copy failed.");
      return false;
    }
  }

  async function handleSubmit() {
    const typedMessage = messageInput.value.trim();
    const message = typedMessage || getAttachmentOnlyMessage(selectedAttachments.value);

    if (!message || isSending.value) return;

    const chat = ensureActiveChat();
    const mode = selectedMode.value;
    const model = getModelForMode(mode, selectedModel.value, modelOptions.value);
    const shouldResetQuickActionMode = quickActionMode.value === mode && selectedAttachments.value.length === 0;
    const history = buildRequestHistory(chat);
    const attachmentsForRequest =
      selectedAttachments.value.length > 0 ? createRequestAttachments(selectedAttachments.value) : null;
    const displayAttachments =
      selectedAttachments.value.length > 0 ? createAttachments(selectedAttachments.value) : undefined;
    const userMessage = createChatMessage({
      role: "user",
      content: message,
      mode,
      model,
      attachments: displayAttachments,
    });
    const nextChat = {
      ...chat,
      title: chat.title === "New QA Chat" ? message.slice(0, 35) : chat.title,
      mode,
      model,
      messages: [...chat.messages, userMessage],
    };

    updateChat(nextChat);
    messageInput.value = "";
    clearSelectedAttachments();
    isSending.value = true;

    await scrollChatToBottom();

    try {
      const response = await sendMessageToAI({
        attachments: attachmentsForRequest,
        history,
        message,
        mode,
        model,
      });

      updateChat({
        ...nextChat,
        messages: [
          ...nextChat.messages,
          createChatMessage({
            role: "assistant",
            content: response.reply,
            mode: response.mode || mode,
            model: response.model,
          }),
        ],
      });

      usageSummary.value = response.usage || usageSummary.value;
      guestLimitReached.value = false;
    } catch (error) {
      const fallback =
        error instanceof Error
          ? error.message
          : "Sorry, something went wrong. Please make sure the backend server is running.";

      if (error instanceof ChatApiError && error.code === "USAGE_LIMIT_REACHED") {
        guestLimitReached.value = true;
      }

      updateChat({
        ...nextChat,
        messages: [
          ...nextChat.messages,
          createChatMessage({
            role: "assistant",
            content: fallback,
            mode: selectedMode.value,
            model,
            isError: true,
          }),
        ],
      });
    } finally {
      if (shouldResetQuickActionMode) {
        selectedMode.value = DEFAULT_MODE;
      }

      quickActionMode.value = null;
      isSending.value = false;
      await scrollChatToBottom();
    }
  }

  function clearGuestLimitReached() {
    guestLimitReached.value = false;
  }

  function applyQuickAction(action: QuickAction) {
    selectedMode.value = action.mode;
    messageInput.value = action.prompt;
    quickActionMode.value = action.mode;
  }

  async function scrollChatToBottom() {
    await nextTick();
    const chatArea = document.querySelector(".chat-area");

    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
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
