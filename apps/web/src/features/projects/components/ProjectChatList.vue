<script setup lang="ts">
import type { Chat } from "../../chat/types";
import { formatRelativeDate } from "../projectDate";

defineProps<{
  chats: Chat[];
}>();

const emit = defineEmits<{
  "open-chat": [chatId: string];
}>();
</script>

<template>
  <div v-if="chats.length === 0" class="workspace-panel project-detail-empty">
    Start a chat to organize conversations under this project.
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
      <small>Last message {{ formatRelativeDate(chat.updatedAt) }}</small>
    </button>
  </div>
</template>
