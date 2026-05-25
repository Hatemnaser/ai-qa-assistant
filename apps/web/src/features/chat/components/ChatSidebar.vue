<script setup lang="ts">
import type { AuthUser } from "../../auth/types";
import SidebarAccountMenu from "./SidebarAccountMenu.vue";
import SidebarChatItem from "./SidebarChatItem.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import type { Chat, ExportFormat } from "../types";

defineProps<{
  activeChatId: string | null;
  chats: Chat[];
  currentUser?: AuthUser | null;
  renamingChatId: string | null;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "new-chat": [];
  "open-settings": [];
  "open-usage": [];
  "select-chat": [chatId: string];
  "sign-in": [];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
  "toggle-theme": [];
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

    <SidebarAccountMenu
      :current-user="currentUser"
      :theme-toggle-label="themeToggleLabel"
      @export-active-chat="emit('export-active-chat', $event)"
      @import-chat="emit('import-chat', $event)"
      @logout="emit('logout')"
      @open-settings="emit('open-settings')"
      @open-usage="emit('open-usage')"
      @sign-in="emit('sign-in')"
      @toggle-theme="emit('toggle-theme')"
    />
  </aside>
</template>
