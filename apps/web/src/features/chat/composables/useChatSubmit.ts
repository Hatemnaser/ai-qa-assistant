import { nextTick, ref } from "vue";
import type { Ref } from "vue";

import { ChatApiError, sendMessageToAI } from "../chatApi";
import { prepareChatAttachmentsForSubmit } from "../chatAttachmentSubmission";
import { buildRequestHistory, createChatMessage } from "../chatMessages";
import { getModelForMode } from "../constants";
import { useI18n } from "../../../i18n/useI18n";
import type { AiModelOption, Chat, ChatUsageSummary, SelectedAttachment } from "../types";

interface ChatSubmitOptions {
  ensureActiveChat: () => Chat;
  captureSubmission: (chatId: string) => {
    getChat: () => Chat | null;
    isActive: () => boolean;
    consumeDraft: (resetQuickAction: boolean) => void;
  };
  getAttachmentOnlyMessage: (attachments: SelectedAttachment[]) => string;
  getIdentity: () => string | null;
  isAuthenticated: () => boolean;
  messageInput: Ref<string>;
  modelOptions: Ref<AiModelOption[]>;
  quickActionMode: Ref<string | null>;
  selectedAttachments: Ref<SelectedAttachment[]>;
  selectedMode: Ref<string>;
  selectedModel: Ref<string>;
  updateChat: (chat: Chat) => void;
}

export interface ChatSubmitDependencies {
  prepareAttachments: typeof prepareChatAttachmentsForSubmit;
  sendMessage: typeof sendMessageToAI;
}

const defaultDependencies: ChatSubmitDependencies = {
  prepareAttachments: prepareChatAttachmentsForSubmit,
  sendMessage: sendMessageToAI,
};

export function useChatSubmit({
  captureSubmission,
  ensureActiveChat,
  getAttachmentOnlyMessage,
  getIdentity,
  isAuthenticated,
  messageInput,
  modelOptions,
  quickActionMode,
  selectedAttachments,
  selectedMode,
  selectedModel,
  updateChat,
}: ChatSubmitOptions, dependencies: ChatSubmitDependencies = defaultDependencies) {
  const usageSummary = ref<ChatUsageSummary | null>(null);
  const guestLimitReached = ref(false);
  const isSending = ref(false);
  const sendingChatId = ref<string | null>(null);
  const { t } = useI18n();

  async function handleSubmit() {
    const typedMessage = messageInput.value.trim();
    const message = typedMessage || getAttachmentOnlyMessage(selectedAttachments.value);

    if (!message || isSending.value) return;

    const chat = ensureActiveChat();
    const origin = captureSubmission(chat.id);
    const identity = getIdentity();
    const getCurrentChat = () => getIdentity() === identity ? origin.getChat() : null;
    const mode = selectedMode.value;
    const model = getModelForMode(mode, selectedModel.value, modelOptions.value);
    const shouldResetQuickActionMode = quickActionMode.value === mode && selectedAttachments.value.length === 0;
    const history = buildRequestHistory(chat);
    const attachments = [...selectedAttachments.value];
    isSending.value = true;
    sendingChatId.value = chat.id;

    try {
      const preparedAttachments = await dependencies.prepareAttachments(attachments, {
        isAuthenticated: isAuthenticated(),
        projectId: chat.projectId,
      });
      const currentChat = getCurrentChat();
      if (!currentChat) return;
      const userMessage = createChatMessage({
        role: "user",
        content: message,
        mode,
        model,
        attachments: preparedAttachments.displayAttachments,
      });
      updateChat({
        ...currentChat,
        title: currentChat.title === "New QA Chat" ? message.slice(0, 35) : currentChat.title,
        mode,
        model,
        messages: [...currentChat.messages, userMessage],
      });

      origin.consumeDraft(shouldResetQuickActionMode);
      if (origin.isActive()) await scrollChatToBottom(() => Boolean(getCurrentChat()) && origin.isActive());
      if (!getCurrentChat()) return;

      const response = await dependencies.sendMessage({
        attachments: preparedAttachments.requestAttachments,
        chatId: chat.id,
        history,
        message,
        mode,
        model,
        projectId: chat.projectId,
      });
      const responseChat = getCurrentChat();
      if (!responseChat) return;

      updateChat({
        ...responseChat,
        messages: [
          ...responseChat.messages,
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
      const errorChat = getCurrentChat();
      if (!errorChat) return;
      const fallback =
        error instanceof Error
          ? error.message
          : t("errors.chat.generic");

      if (error instanceof ChatApiError && error.code === "USAGE_LIMIT_REACHED") {
        guestLimitReached.value = true;
      }

      updateChat({
        ...errorChat,
        messages: [
          ...errorChat.messages,
          createChatMessage({
            role: "assistant",
            content: fallback,
            mode,
            model,
            isError: true,
          }),
        ],
      });
    } finally {
      isSending.value = false;
      sendingChatId.value = null;
      if (getCurrentChat() && origin.isActive()) await scrollChatToBottom(() => Boolean(getCurrentChat()) && origin.isActive());
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
    sendingChatId,
    usageSummary,
  };
}

async function scrollChatToBottom(isCurrent: () => boolean) {
  await nextTick();
  if (!isCurrent()) return;
  const chatArea = globalThis.document?.querySelector(".chat-area");

  if (chatArea && (chatArea as HTMLElement).dataset?.followLatest !== "false") {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}
