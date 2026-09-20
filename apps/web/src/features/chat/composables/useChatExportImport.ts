import type { Ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
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
  getIdentity?: () => string | null;
}

export function useChatExportImport({
  activeChat,
  addChatAndSelect,
  closeChatMenus,
  getIdentity = () => null,
}: ChatExportImportOptions) {
  const { t } = useI18n();

  function exportActiveChat(format: ExportFormat = "json") {
    if (!activeChat.value) {
      alert(t("chat.export.noActive"));
      return;
    }

    exportChat(activeChat.value, format);
  }

  function exportChat(chat: Chat, format: ExportFormat) {
    exportChatByFormat(chat, format);
    closeChatMenus();
  }

  async function handleImportChat(event: Event) {
    const identity = getIdentity();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = "";

    if (!file) return null;

    if (!file.name.toLowerCase().endsWith(".json")) {
      alert(t("chat.import.jsonOnly"));
      return null;
    }

    try {
      const text = await file.text();
      if (getIdentity() !== identity) return null;
      const importedChat = parseImportedChatJson(text, {
        defaultAttachmentName: t("chat.import.defaultAttachmentName"),
        defaultTitle: t("chat.import.defaultTitle"),
      });
      addChatAndSelect(importedChat);
      return importedChat;
    } catch {
      if (getIdentity() === identity) alert(t("chat.import.failed"));
      return null;
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
      alert(t("chat.messages.copyFailed"));
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
