import { nextTick, ref, watch } from "vue";

import { sendMessageToAI } from "../chatApi";
import {
  exportAnswerByFormat,
  exportChatByFormat,
  parseImportedChatJson,
} from "../chatExport";
import { fileToSelectedImage, getImageFileError } from "../chatImages";
import { buildRequestHistory, createChatMessage, createImageAttachment } from "../chatMessages";
import { DEFAULT_MODE, DEFAULT_MODEL, getModelForMode } from "../constants";
import { useStoredChats } from "./useStoredChats";
import { useChatMenus } from "./useChatMenus";
import type { QuickAction } from "../constants";
import type {
  Chat,
  ChatAttachment,
  ChatMessage,
  ExportFormat,
  SelectedImage,
} from "../types";

export function useChatController() {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const selectedImage = ref<SelectedImage | null>(null);
  const chatPendingDelete = ref<Chat | null>(null);
  const renamingChatId = ref<string | null>(null);
  const isSending = ref(false);

  function clearSelectedImage() {
    selectedImage.value = null;
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
    selectChat: selectStoredChat,
    startNewChat: startStoredNewChat,
    updateChat,
  } = useStoredChats({
    clearSelectedImage,
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
    const message = typedMessage || (selectedImage.value ? "Analyze this screenshot as a QA engineer." : "");

    if (!message || isSending.value) return;

    const chat = ensureActiveChat();
    const mode = selectedImage.value ? "screenshot_review" : selectedMode.value;
    const model = getModelForMode(mode, selectedModel.value);
    const history = buildRequestHistory(chat);
    const imageForRequest = selectedImage.value
      ? {
          data: selectedImage.value.data,
          mimeType: selectedImage.value.mimeType,
        }
      : null;
    const displayAttachment = selectedImage.value ? createImageAttachment(selectedImage.value) : undefined;
    const userMessage = createChatMessage({
      role: "user",
      content: message,
      mode,
      model,
      attachment: displayAttachment,
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
    clearSelectedImage();
    isSending.value = true;

    await scrollChatToBottom();

    try {
      const response = await sendMessageToAI({
        history,
        image: imageForRequest,
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
    } catch (error) {
      const fallback =
        error instanceof Error
          ? error.message
          : "Sorry, something went wrong. Please make sure the backend server is running.";

      updateChat({
        ...nextChat,
        messages: [
          ...nextChat.messages,
          createChatMessage({
            role: "assistant",
            content: fallback,
            mode: selectedMode.value,
            model,
          }),
        ],
      });
    } finally {
      isSending.value = false;
      await scrollChatToBottom();
    }
  }

  function applyQuickAction(action: QuickAction) {
    selectedMode.value = action.mode;
    messageInput.value = action.prompt;
  }

  async function scrollChatToBottom() {
    await nextTick();
    const chatArea = document.querySelector(".chat-area");

    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }

  async function handleImageSelected(file: File | undefined) {
    await handleImageFile(file);
  }

  async function handleImageFile(file: File | undefined) {
    if (!file) return;

    const fileError = getImageFileError(file);

    if (fileError) {
      alert(fileError);
      return;
    }

    selectedImage.value = await fileToSelectedImage(file);
    selectedMode.value = "screenshot_review";
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.previewUrl) {
      window.open(attachment.previewUrl, "_blank");
    }
  }

  function openSelectedImage() {
    if (selectedImage.value?.previewUrl) {
      window.open(selectedImage.value.previewUrl, "_blank");
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
    clearSelectedImage,
    confirmDeleteChat,
    copyAnswer,
    exportActiveChat,
    exportAnswer,
    exportChat,
    handleImageSelected,
    handleImportChat,
    handleSubmit,
    isSending,
    messageInput,
    openAttachment,
    openChatMenu,
    openChatMenuForChat,
    openExportMenu,
    openExportMenuChat,
    openExportSubmenu,
    openMenuChat,
    openSelectedImage,
    renamingChatId,
    requestDeleteChat,
    selectChat,
    selectedImage,
    selectedMode,
    selectedModel,
    submitRenameChat,
    startNewChat,
  };
}
