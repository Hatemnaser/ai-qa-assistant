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
function onMenuKeydown(event: KeyboardEvent) {
  if (event.isComposing || !(event.currentTarget instanceof HTMLElement)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | undefined;
  if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % buttons.length;
  if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + buttons.length) % buttons.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = buttons.length - 1;
  if (nextIndex !== undefined) {
    event.preventDefault();
    buttons[nextIndex]?.focus();
    return;
  }
  const openKey = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const button = buttons[activeIndex];
  if (event.key === openKey && button?.hasAttribute("aria-haspopup")) {
    event.preventDefault();
    button.click();
  }
}
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="menuPosition && menuChat"
      id="chat-actions-menu"
      role="menu"
      :aria-label="t('sidebar.chat.menu', { title: menuChat.title })"
      class="workspace-surface chat-dropdown-menu show"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('rename-chat', menuChat)">
          {{ t("chat.menu.rename") }}
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button" aria-haspopup="menu" :aria-expanded="Boolean(projectMenu)" aria-controls="chat-project-menu" @click="emit('open-project-submenu', $event, menuChat.id)">
          <span>{{ menuChat.projectId ? t("chat.menu.moveToProject") : t("chat.menu.addToProject") }}</span>
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li role="none" v-if="menuChat.projectId && getProjectName(menuChat.projectId)">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('assign-chat-project', menuChat.id, null)">
          {{ t("chat.menu.removeFromProject", { project: getProjectName(menuChat.projectId) }) }}
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="button" aria-haspopup="menu" :aria-expanded="Boolean(exportMenu)" aria-controls="chat-export-menu" @click="emit('open-export-submenu', $event, menuChat.id)">
          <span>{{ t("chat.menu.export") }}</span><span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item dropdown-item-danger" type="button" @click="emit('delete-chat', menuChat.id)">
          {{ t("app.actions.delete") }}
        </button>
      </li>
    </ul>

    <ul
      v-if="projectMenu && projectMenuChat"
      id="chat-project-menu"
      role="menu"
      :aria-label="t('sidebar.nav.projects')"
      class="workspace-surface chat-dropdown-menu chat-project-submenu show"
      :style="{ left: `${projectMenu.left}px`, top: `${projectMenu.top}px` }"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('create-project-for-chat', projectMenuChat.id)">
          {{ t("sidebar.nav.newProject") }}
        </button>
      </li>
      <li role="none" v-if="getProjectMenuProjects(projectMenuChat).length > 0">
        <hr class="dropdown-divider" />
      </li>
      <li role="none" v-for="project in getProjectMenuProjects(projectMenuChat)" :key="project.id">
        <button
          role="menuitem"
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
      id="chat-export-menu"
      role="menu"
      :aria-label="t('chat.menu.export')"
      class="workspace-surface chat-dropdown-menu chat-export-submenu show"
      :style="{ left: `${exportMenu.left}px`, top: `${exportMenu.top}px` }"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'md')">
          MD
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'txt')">
          TXT
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'csv')">
          CSV
        </button>
      </li>
      <li role="none">
        <button role="menuitem" class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'json')">
          JSON
        </button>
      </li>
    </ul>
  </Teleport>
</template>
