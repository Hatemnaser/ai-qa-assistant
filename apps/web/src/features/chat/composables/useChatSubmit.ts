import { nextTick, ref } from "vue";
import type { Ref } from "vue";

import { ChatApiError, sendMessageToAI } from "../chatApi";
import { createAttachments, createRequestAttachments } from "../chatAttachments";
import { buildRequestHistory, createChatMessage } from "../chatMessages";
import { DEFAULT_MODE, getModelForMode } from "../constants";
import { useI18n } from "../../../i18n/useI18n";
import type { AiModelOption, Chat, ChatUsageSummary, SelectedAttachment } from "../types";

interface ChatSubmitOptions {
  clearSelectedAttachments: () => void;
  ensureActiveChat: () => Chat;
  getAttachmentOnlyMessage: (attachments: SelectedAttachment[]) => string;
  messageInput: Ref<string>;
  modelOptions: Ref<AiModelOption[]>;
  quickActionMode: Ref<string | null>;
  selectedAttachments: Ref<SelectedAttachment[]>;
  selectedMode: Ref<string>;
  selectedModel: Ref<string>;
  updateChat: (chat: Chat) => void;
}

export function useChatSubmit({
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
}: ChatSubmitOptions) {
  const usageSummary = ref<ChatUsageSummary | null>(null);
  const guestLimitReached = ref(false);
  const isSending = ref(false);
  const { t } = useI18n();

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
        chatId: chat.id,
        history,
        message,
        mode,
        model,
        projectId: chat.projectId,
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
          : t("errors.chat.generic");

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

  return {
    clearGuestLimitReached,
    guestLimitReached,
    handleSubmit,
    isSending,
    usageSummary,
  };
}

async function scrollChatToBottom() {
  await nextTick();
  const chatArea = document.querySelector(".chat-area");

  if (chatArea) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}
