<script setup lang="ts">
import type { Project } from "../../projects/types";
import { useI18n } from "../../../i18n/useI18n";
import type { Chat, ExportFormat, MenuPosition } from "../types";

const props = defineProps<{
  exportMenu: MenuPosition | null;
  exportMenuChat: Chat | null;
  menuChat: Chat | null;
  menuPosition: MenuPosition | null;
  projectMenu: MenuPosition | null;
  projectMenuChat: Chat | null;
  projects: Project[];
}>();

const { t } = useI18n();

const emit = defineEmits<{
  "assign-chat-project": [chatId: string, projectId: string | null];
  "create-project-for-chat": [chatId: string];
  "delete-chat": [chatId: string];
  "export-chat": [chat: Chat, format: ExportFormat];
  "open-export-submenu": [event: MouseEvent, chatId: string];
  "open-project-submenu": [event: MouseEvent, chatId: string];
  "rename-chat": [chat: Chat];
}>();

function getProjectName(projectId: string | null) {
  return props.projects.find((project) => project.id === projectId)?.name || "";
}

function getProjectMenuProjects(chat: Chat) {
  if (!chat.projectId) {
    return props.projects;
  }

  return props.projects.filter((project) => project.id !== chat.projectId);
}
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
          {{ t("chat.menu.rename") }}
        </button>
      </li>
      <li @mouseenter="emit('open-project-submenu', $event, menuChat.id)">
        <button class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button">
          <span>{{ menuChat.projectId ? t("chat.menu.moveToProject") : t("chat.menu.addToProject") }}</span>
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li v-if="menuChat.projectId && getProjectName(menuChat.projectId)">
        <button class="dropdown-item" type="button" @click="emit('assign-chat-project', menuChat.id, null)">
          {{ t("chat.menu.removeFromProject", { project: getProjectName(menuChat.projectId) }) }}
        </button>
      </li>
      <li @mouseenter="emit('open-export-submenu', $event, menuChat.id)">
        <button class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button">
          <span>{{ t("chat.menu.export") }}</span><span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li>
        <button class="dropdown-item dropdown-item-danger" type="button" @click="emit('delete-chat', menuChat.id)">
          {{ t("app.actions.delete") }}
        </button>
      </li>
    </ul>

    <ul
      v-if="projectMenu && projectMenuChat"
      class="chat-dropdown-menu chat-project-submenu show"
      :style="{ left: `${projectMenu.left}px`, top: `${projectMenu.top}px` }"
      @click.stop
    >
      <li>
        <button class="dropdown-item" type="button" @click="emit('create-project-for-chat', projectMenuChat.id)">
          {{ t("sidebar.nav.newProject") }}
        </button>
      </li>
      <li v-if="getProjectMenuProjects(projectMenuChat).length > 0">
        <hr class="dropdown-divider" />
      </li>
      <li v-for="project in getProjectMenuProjects(projectMenuChat)" :key="project.id">
        <button
          class="dropdown-item"
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
