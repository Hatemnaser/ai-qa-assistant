<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { AuthUser } from "../../auth/types";
import type { Project } from "../../projects/types";
import Icon from "../../../ui/Icon.vue";
import SidebarAccountMenu from "./SidebarAccountMenu.vue";
import SidebarChatItem from "./SidebarChatItem.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import { useI18n } from "../../../i18n/useI18n";
import type { Chat, ExportFormat } from "../types";

const props = defineProps<{
  activeChatId: string | null;
  activeProjectId?: string | null;
  chats: Chat[];
  currentUser?: AuthUser | null;
  isChatRoute: boolean;
  isProjectsRoute: boolean;
  projects: Project[];
  renamingChatId: string | null;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "new-chat": [];
  "new-project": [];
  "open-project": [projectId: string];
  "open-projects": [];
  "open-settings": [];
  "open-usage": [];
  "select-chat": [chatId: string];
  "sign-in": [];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
  "toggle-theme": [];
}>();

const areProjectsOpen = ref(true);
const areRecentChatsOpen = ref(true);
const expandedProjectIds = ref<Set<string>>(new Set());
const { t } = useI18n();
const activeChatProjectId = computed(
  () => props.chats.find((chat) => chat.id === props.activeChatId)?.projectId || null
);
const projectChatsByProjectId = computed(() => {
  const groups = new Map<string, Chat[]>();

  for (const chat of props.chats) {
    if (!chat.projectId) continue;

    const projectChats = groups.get(chat.projectId);

    if (projectChats) {
      projectChats.push(chat);
    } else {
      groups.set(chat.projectId, [chat]);
    }
  }

  return groups;
});
const recentChats = computed(() =>
  props.projects.length > 0 ? props.chats.filter((chat) => !chat.projectId) : props.chats
);

watch(
  () => props.projects.length,
  (projectCount) => {
    if (projectCount > 0) {
      areProjectsOpen.value = true;
    }
  }
);

watch(
  () => props.activeProjectId,
  (projectId) => {
    if (projectId) {
      areProjectsOpen.value = true;
      expandProject(projectId);
    }
  },
  { immediate: true }
);

watch(
  activeChatProjectId,
  (projectId) => {
    if (projectId) {
      areProjectsOpen.value = true;
      expandProject(projectId);
    }
  },
  { immediate: true }
);

function getProjectChats(projectId: string) {
  return projectChatsByProjectId.value.get(projectId) || [];
}

function hasProjectChats(projectId: string) {
  return getProjectChats(projectId).length > 0;
}

function isProjectExpanded(projectId: string) {
  return hasProjectChats(projectId) && expandedProjectIds.value.has(projectId);
}

function isProjectActive(projectId: string) {
  return activeChatProjectId.value === projectId && !isProjectExpanded(projectId);
}

function toggleProject(projectId: string) {
  if (!hasProjectChats(projectId)) return;

  const nextExpandedProjects = new Set(expandedProjectIds.value);

  if (nextExpandedProjects.has(projectId)) {
    nextExpandedProjects.delete(projectId);
  } else {
    nextExpandedProjects.add(projectId);
  }

  expandedProjectIds.value = nextExpandedProjects;
}

function expandProject(projectId: string) {
  if (!hasProjectChats(projectId)) return;
  if (expandedProjectIds.value.has(projectId)) return;

  expandedProjectIds.value = new Set([...expandedProjectIds.value, projectId]);
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <h1>{{ t("app.brand.name") }}</h1>
      <p>{{ t("app.brand.description") }}</p>
    </div>

    <nav class="sidebar-nav" :aria-label="t('sidebar.nav.workspace')">
      <SidebarNavItem
        icon="plus"
        :label="t('sidebar.nav.newChat')"
        :active="isChatRoute && activeChatId === null"
        @click="emit('new-chat')"
      />
      <SidebarNavItem icon="search" :label="t('sidebar.nav.search')" />
      <SidebarNavItem
        v-if="projects.length === 0"
        icon="folder"
        :label="t('sidebar.nav.projects')"
        :active="isProjectsRoute"
        @click="emit('open-projects')"
      />
    </nav>

    <div class="sidebar-scroll">
      <section v-if="projects.length > 0" class="sidebar-section">
        <button
          class="sidebar-section-toggle"
          type="button"
          :aria-expanded="areProjectsOpen"
          @click="areProjectsOpen = !areProjectsOpen"
        >
          <span>{{ t("sidebar.nav.projects") }}</span>
          <span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span>
        </button>

        <div v-if="areProjectsOpen" class="sidebar-section-body">
          <SidebarNavItem icon="plus" :label="t('sidebar.nav.newProject')" @click="emit('new-project')" />
          <SidebarNavItem
            icon="folder"
            :label="t('sidebar.nav.allProjects')"
            :active="isProjectsRoute && !activeProjectId"
            @click="emit('open-projects')"
          />

          <div v-for="project in projects" :key="project.id" class="sidebar-project-group">
            <div
              class="ui-row ui-row--compact ui-row--interactive sidebar-project-row"
              :class="{ active: isProjectActive(project.id) }"
            >
              <button
                class="ui-row__button sidebar-project-toggle"
                type="button"
                :aria-expanded="isProjectExpanded(project.id)"
                :aria-disabled="!hasProjectChats(project.id)"
                @click="toggleProject(project.id)"
              >
                <span class="ui-row__icon" aria-hidden="true">
                  <Icon :name="isProjectExpanded(project.id) ? 'folder-open' : 'folder'" />
                </span>
                <span class="ui-row__title">{{ project.name }}</span>
              </button>

              <div class="ui-row__action sidebar-project-actions">
                <button
                  class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
                  type="button"
                  :aria-label="t('sidebar.project.openPage')"
                  @click.stop="emit('open-project', project.id)"
                >
                  &#8599;
                </button>
              </div>
            </div>

            <div v-if="isProjectExpanded(project.id)" class="sidebar-project-chats">
              <SidebarChatItem
                v-for="chat in getProjectChats(project.id)"
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
        </div>
      </section>

      <section class="sidebar-section">
        <button
          class="sidebar-section-toggle"
          type="button"
          :aria-expanded="areRecentChatsOpen"
          @click="areRecentChatsOpen = !areRecentChatsOpen"
        >
          <span>{{ t("sidebar.nav.recentChats") }}</span>
          <span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span>
        </button>

        <template v-if="areRecentChatsOpen">
          <div v-if="recentChats.length > 0" class="chat-list">
            <SidebarChatItem
              v-for="chat in recentChats"
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

          <div v-else class="sidebar-empty">{{ t("sidebar.nav.noRecentChats") }}</div>
        </template>
      </section>
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
