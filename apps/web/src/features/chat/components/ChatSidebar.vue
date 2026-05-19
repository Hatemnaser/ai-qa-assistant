<script setup lang="ts">
import SidebarChatItem from "./SidebarChatItem.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import type { Chat } from "../types";

defineProps<{
  activeChatId: string | null;
  chats: Chat[];
  renamingChatId: string | null;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "new-chat": [];
  "select-chat": [chatId: string];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
}>();
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <h1>AI QA Assistant</h1>
      <p>QA workspace for test cases, bug reports, edge cases, and checklists.</p>
    </div>

    <nav class="sidebar-nav" aria-label="Workspace">
      <SidebarNavItem icon="plus" label="New Chat" :active="activeChatId === null" @click="emit('new-chat')" />
      <SidebarNavItem icon="search" label="Search" />
      <SidebarNavItem icon="folder" label="Projects" />
    </nav>

    <div class="sidebar-section">
      <div class="sidebar-title">Recent Chats</div>

      <div class="chat-list">
        <SidebarChatItem
          v-for="chat in chats"
          :key="chat.id"
          :active="chat.id === activeChatId"
          :chat="chat"
          :renaming="chat.id === renamingChatId"
          @cancel-rename="emit('cancel-rename')"
          @open-menu="(event, chatId) => emit('open-chat-menu', event, chatId)"
          @rename="(chatId, title) => emit('rename-chat', chatId, title)"
          @select="emit('select-chat', $event)"
        />
      </div>
    </div>
  </aside>
</template>
