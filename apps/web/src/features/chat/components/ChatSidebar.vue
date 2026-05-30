<script setup lang="ts">
import { computed } from "vue";

import type { AuthUser } from "../../auth/types";
import type { Project } from "../../projects/types";
import {
  filterChatsByProject,
  getChatProjectFilterOptions,
  getProjectNameById,
  type ChatProjectFilter,
} from "../chatProjectFilters";
import SidebarAccountMenu from "./SidebarAccountMenu.vue";
import SidebarChatItem from "./SidebarChatItem.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import type { Chat, ExportFormat } from "../types";

const props = defineProps<{
  activeChatId: string | null;
  chats: Chat[];
  currentUser?: AuthUser | null;
  isChatRoute: boolean;
  isProjectsRoute: boolean;
  projectFilter: ChatProjectFilter;
  projects?: Project[];
  renamingChatId: string | null;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "new-chat": [];
  "open-projects": [];
  "open-settings": [];
  "open-usage": [];
  "select-project-filter": [filter: ChatProjectFilter];
  "select-chat": [chatId: string];
  "sign-in": [];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
  "toggle-theme": [];
}>();

const projects = computed(() => props.projects || []);
const filteredChats = computed(() => filterChatsByProject(props.chats, props.projectFilter));
const showProjectFilters = computed(() => Boolean(props.currentUser));
const projectFilterOptions = computed(() => getChatProjectFilterOptions(props.chats, projects.value));

function getChatProjectName(chat: Chat) {
  return getProjectNameById(projects.value, chat.projectId);
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <h1>AI QA Assistant</h1>
      <p>QA workspace for test cases, bug reports, edge cases, and checklists.</p>
    </div>

    <nav class="sidebar-nav" aria-label="Workspace">
      <SidebarNavItem
        icon="plus"
        label="New Chat"
        :active="isChatRoute && activeChatId === null"
        @click="emit('new-chat')"
      />
      <SidebarNavItem icon="search" label="Search" />
      <SidebarNavItem icon="folder" label="Projects" :active="isProjectsRoute" @click="emit('open-projects')" />
    </nav>

    <div v-if="showProjectFilters" class="sidebar-project-filter">
      <div class="sidebar-title">Chat Scope</div>

      <div class="sidebar-project-filter-list">
        <button
          v-for="option in projectFilterOptions"
          :key="option.value"
          class="ui-row ui-row--button ui-row--interactive sidebar-filter-row"
          :class="{ active: option.value === projectFilter }"
          type="button"
          :aria-pressed="option.value === projectFilter"
          @click="emit('select-project-filter', option.value)"
        >
          <span class="ui-row__title">{{ option.label }}</span>
          <span class="ui-row__count">{{ option.count }}</span>
        </button>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-title">Recent Chats</div>

      <div v-if="filteredChats.length > 0" class="chat-list">
        <SidebarChatItem
          v-for="chat in filteredChats"
          :key="chat.id"
          :active="chat.id === activeChatId"
          :chat="chat"
          :project-name="getChatProjectName(chat)"
          :renaming="chat.id === renamingChatId"
          @cancel-rename="emit('cancel-rename')"
          @open-menu="(event, chatId) => emit('open-chat-menu', event, chatId)"
          @rename="(chatId, title) => emit('rename-chat', chatId, title)"
          @select="emit('select-chat', $event)"
        />
      </div>

      <div v-else class="sidebar-empty">No chats in this scope.</div>
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
