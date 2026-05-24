import { nextTick, ref, watch } from "vue";

import { ChatApiError, sendMessageToAI } from "../chatApi";
import {
  exportAnswerByFormat,
  exportChatByFormat,
  parseImportedChatJson,
} from "../chatExport";
import {
  createAttachments,
  createRequestAttachments,
  fileToSelectedAttachment,
  getAttachmentFileError,
  MAX_SELECTED_ATTACHMENTS,
} from "../chatAttachments";
import { buildRequestHistory, createChatMessage } from "../chatMessages";
import { DEFAULT_MODE, DEFAULT_MODEL, getModelForMode } from "../constants";
import { useStoredChats } from "./useStoredChats";
import { useChatMenus } from "./useChatMenus";
import type { QuickAction } from "../constants";
import type {
  Chat,
  ChatAttachment,
  ChatMessage,
  ChatUsageSummary,
  ExportFormat,
  SelectedAttachment,
} from "../types";

export function useChatController() {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const selectedAttachments = ref<SelectedAttachment[]>([]);
  const chatPendingDelete = ref<Chat | null>(null);
  const renamingChatId = ref<string | null>(null);
  const quickActionMode = ref<string | null>(null);
  const usageSummary = ref<ChatUsageSummary | null>(null);
  const guestLimitReached = ref(false);
  const isSending = ref(false);

  function clearSelectedAttachments() {
    selectedAttachments.value = [];
  }

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
    const nextModel = getModelForMode(selectedMode.value, selectedModel.value);

    if (selectedModel.value !== nextModel) {
      selectedModel.value = nextModel;
    }
  }

  watch(selectedMode, syncModelForSelectedMode);
  watch(selectedModel, syncModelForSelectedMode);

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
    const model = getModelForMode(mode, selectedModel.value);
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

  async function handleAttachmentsSelected(files: File[] | FileList | undefined) {
    await handleAttachmentFiles(files);
  }

  async function handleAttachmentFiles(files: File[] | FileList | undefined) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.length === 0) return;

    if (selectedAttachments.value.length + selectedFiles.length > MAX_SELECTED_ATTACHMENTS) {
      alert(`You can attach up to ${MAX_SELECTED_ATTACHMENTS} files per message.`);
      return;
    }

    const fileError = selectedFiles.map(getAttachmentFileError).find(Boolean);

    if (fileError) {
      alert(fileError);
      return;
    }

    const nextAttachments = await Promise.all(selectedFiles.map(fileToSelectedAttachment));

    selectedAttachments.value = [...selectedAttachments.value, ...nextAttachments];
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.previewUrl) {
      window.open(attachment.previewUrl, "_blank");
    }
  }

  function openSelectedAttachment(index: number) {
    const attachment = selectedAttachments.value[index];

    if (attachment?.previewUrl) {
      window.open(attachment.previewUrl, "_blank");
    }
  }

  function removeSelectedAttachment(index: number) {
    selectedAttachments.value = selectedAttachments.value.filter((_, itemIndex) => itemIndex !== index);
  }

  function getAttachmentOnlyMessage(attachments: SelectedAttachment[]) {
    if (attachments.length === 0) return "";
    if (attachments.length > 1) return `Uploaded ${attachments.length} attachments.`;

    const attachment = attachments[0];
    if (!attachment) return "";

    return attachment.type === "image" ? "Uploaded an image." : "Uploaded an attachment.";
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
    messageInput,
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
