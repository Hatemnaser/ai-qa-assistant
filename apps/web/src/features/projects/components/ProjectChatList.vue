<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";
import type { Chat } from "../../chat/types";
import { formatRelativeDate } from "../projectDate";

defineProps<{
  chats: Chat[];
}>();

const emit = defineEmits<{
  "open-chat": [chatId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="chats.length === 0" class="workspace-panel project-detail-empty">
    {{ t("projects.chatList.empty") }}
  </div>

  <div v-else class="project-chat-list">
    <button
      v-for="chat in chats"
      :key="chat.id"
      class="project-chat-item"
      type="button"
      @click="emit('open-chat', chat.id)"
    >
      <span>{{ chat.title }}</span>
      <small>{{ t("projects.chatList.lastMessage", { date: formatRelativeDate(chat.updatedAt) }) }}</small>
    </button>
  </div>
</template>
