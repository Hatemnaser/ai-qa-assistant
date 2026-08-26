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
}

export function useChatExportImport({
  activeChat,
  addChatAndSelect,
  closeChatMenus,
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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = "";

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      alert(t("chat.import.jsonOnly"));
      return;
    }

    try {
      const importedChat = parseImportedChatJson(await file.text(), {
        defaultAttachmentName: t("chat.import.defaultAttachmentName"),
        defaultTitle: t("chat.import.defaultTitle"),
      });
      addChatAndSelect(importedChat);
    } catch {
      alert(t("chat.import.failed"));
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
