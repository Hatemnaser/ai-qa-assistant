<script setup lang="ts">
import type { Project } from "../../projects/types";
import type { Chat, ExportFormat, MenuPosition } from "../types";

defineProps<{
  exportMenu: MenuPosition | null;
  exportMenuChat: Chat | null;
  menuChat: Chat | null;
  menuPosition: MenuPosition | null;
  projectMenu: MenuPosition | null;
  projectMenuChat: Chat | null;
  projects: Project[];
}>();

const emit = defineEmits<{
  "assign-chat-project": [chatId: string, projectId: string];
  "delete-chat": [chatId: string];
  "export-chat": [chat: Chat, format: ExportFormat];
  "open-export-submenu": [event: MouseEvent, chatId: string];
  "open-project-submenu": [event: MouseEvent, chatId: string];
  "rename-chat": [chat: Chat];
}>();
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="menuPosition && menuChat"
      class="chat-dropdown-menu show"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @click.stop
    >
      <li>
        <button class="dropdown-item" type="button" @click="emit('rename-chat', menuChat)">
          Rename
        </button>
      </li>
      <li v-if="projects.length > 0" @mouseenter="emit('open-project-submenu', $event, menuChat.id)">
        <button class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button">
          <span>Add to project</span><span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li @mouseenter="emit('open-export-submenu', $event, menuChat.id)">
        <button class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button">
          <span>Export</span><span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li>
        <button class="dropdown-item dropdown-item-danger" type="button" @click="emit('delete-chat', menuChat.id)">
          Delete
        </button>
      </li>
    </ul>

    <ul
      v-if="projectMenu && projectMenuChat && projects.length > 0"
      class="chat-dropdown-menu chat-project-submenu show"
      :style="{ left: `${projectMenu.left}px`, top: `${projectMenu.top}px` }"
      @click.stop
    >
      <li v-for="project in projects" :key="project.id">
        <button
          class="dropdown-item"
          :class="{ active: project.id === projectMenuChat.projectId }"
          type="button"
          :title="project.description || project.name"
          @click="emit('assign-chat-project', projectMenuChat.id, project.id)"
        >
          {{ project.name }}
        </button>
      </li>
    </ul>

    <ul
      v-if="exportMenu && exportMenuChat"
      class="chat-dropdown-menu chat-export-submenu show"
      :style="{ left: `${exportMenu.left}px`, top: `${exportMenu.top}px` }"
      @click.stop
    >
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'md')">
          MD
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'txt')">
          TXT
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'csv')">
          CSV
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'json')">
          JSON
        </button>
      </li>
    </ul>
  </Teleport>
</template>
