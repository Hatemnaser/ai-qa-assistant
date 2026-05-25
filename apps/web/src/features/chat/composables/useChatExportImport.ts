import type { Ref } from "vue";

import {
  exportAnswerByFormat,
  exportChatByFormat,
  parseImportedChatJson,
} from "../chatExport";
import type { Chat, ChatMessage, ExportFormat } from "../types";

interface ChatExportImportOptions {
  activeChat: Ref<Chat | null>;
  addChatAndSelect: (chat: Chat) => void;
  closeChatMenus: () => void;
}

export function useChatExportImport({
  activeChat,
  addChatAndSelect,
  closeChatMenus,
}: ChatExportImportOptions) {
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

  return {
    copyAnswer,
    exportActiveChat,
    exportAnswer,
    exportChat,
    handleImportChat,
  };
}
