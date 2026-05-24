<script setup lang="ts">
import { ref } from "vue";

import { QUICK_ACTIONS } from "../constants";
import { getMessageAttachments } from "../chatMessages";
import { renderMarkdown } from "../markdown";
import type { QuickAction } from "../constants";
import type { ChatAttachment, ChatMessage, ExportFormat } from "../types";

const props = defineProps<{
  copyAnswer: (content: string) => Promise<boolean>;
  isSending: boolean;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  "export-answer": [message: ChatMessage, format: ExportFormat];
  "open-attachment": [attachment: ChatAttachment];
  "quick-action": [action: QuickAction];
}>();

const copyFeedbackByMessageId = ref<Record<string, string>>({});
const welcomeActions = QUICK_ACTIONS.filter((action) => action.mode !== "screenshot_review");

async function copyMessage(message: ChatMessage) {
  const success = await props.copyAnswer(message.content);

  copyFeedbackByMessageId.value = {
    ...copyFeedbackByMessageId.value,
    [message.id]: success ? "Copied" : "Copy failed",
  };

  window.setTimeout(() => {
    copyFeedbackByMessageId.value = {
      ...copyFeedbackByMessageId.value,
      [message.id]: "Copy",
    };
  }, 1500);
}

function copyLabel(message: ChatMessage) {
  return copyFeedbackByMessageId.value[message.id] || "Copy";
}
</script>

<template>
  <section class="chat-area">
    <div v-if="messages.length === 0" class="welcome-message text-center">
      <h3 class="welcome-title">How can I help with QA today?</h3>
      <p>Choose a starting point or write your own QA request.</p>
      <div class="welcome-actions">
        <button
          v-for="action in welcomeActions"
          :key="action.label"
          class="welcome-action"
          type="button"
          @click="emit('quick-action', action)"
        >
          {{ action.label === "QA Checklist" ? "Checklist" : action.label }}
        </button>
      </div>
    </div>

    <div v-for="message in messages" :key="message.id">
      <div v-if="message.role === 'assistant'" class="answer">
        <div class="message-content" v-html="renderMarkdown(message.content)" />
        <div class="message-actions d-flex justify-content-end gap-2">
          <button
            class="ui-icon-btn ui-icon-btn--sm message-action-btn"
            type="button"
            :title="copyLabel(message)"
            aria-label="Copy answer"
            @click="copyMessage(message)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>

          <div class="dropdown">
            <button
              class="ui-icon-btn ui-icon-btn--sm message-action-btn"
              type="button"
              title="Export"
              aria-label="Export answer"
              data-bs-toggle="dropdown"
              aria-expanded="false"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <path d="M7 10l5 5 5-5"></path>
                <path d="M12 15V3"></path>
              </svg>
            </button>

            <ul class="dropdown-menu dropdown-menu-end answer-export-menu">
              <li>
                <button class="dropdown-item" type="button" @click="emit('export-answer', message, 'md')">
                  MD
                </button>
              </li>
              <li>
                <button class="dropdown-item" type="button" @click="emit('export-answer', message, 'txt')">
                  TXT
                </button>
              </li>
              <li>
                <button class="dropdown-item" type="button" @click="emit('export-answer', message, 'csv')">
                  CSV
                </button>
              </li>
              <li>
                <button class="dropdown-item" type="button" @click="emit('export-answer', message, 'json')">
                  JSON
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div v-else class="msg">
        <button
          v-for="(attachment, index) in getMessageAttachments(message)"
          :key="`${message.id}-${attachment.name}-${attachment.mimeType}-${index}`"
          class="chat-attachment-card d-flex align-items-center"
          type="button"
          @click="emit('open-attachment', attachment)"
        >
          <img
            v-if="attachment.type === 'image' && attachment.previewUrl"
            :src="attachment.previewUrl"
            :alt="attachment.name"
            class="chat-attachment-thumb"
          />
          <span class="chat-attachment-meta">
            <span class="chat-attachment-name">{{ attachment.name }}</span>
            <span class="chat-attachment-type">
              {{ attachment.type === "image" ? "Image" : "File" }}
            </span>
          </span>
        </button>
        <div class="message-text">{{ message.content }}</div>
      </div>
    </div>

    <div v-if="isSending" class="answer">Thinking...</div>
  </section>
</template>
