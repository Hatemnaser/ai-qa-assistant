<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { AuthUser } from "../../auth/types";
import type { Project } from "../../projects/types";
import Icon from "../../../ui/Icon.vue";
import SidebarAccountMenu from "./SidebarAccountMenu.vue";
import SidebarChatItem from "./SidebarChatItem.vue";
import SidebarNavItem from "./SidebarNavItem.vue";
import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { Chat, ExportFormat } from "../types";

const props = defineProps<{
  activeChatId: string | null;
  activeProjectId?: string | null;
  chats: Chat[];
  currentUser?: AuthUser | null;
  isChatRoute: boolean;
  isHomeRoute?: boolean;
  isProjectsRoute: boolean;
  isWorkspaceRoute: boolean;
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
  "open-home": [];
  "open-project": [projectId: string];
  "open-projects": [];
  "open-settings": [];
  "open-usage": [];
  "open-workspace": [];
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
const isMobile = ref(typeof window !== "undefined" && window.innerWidth < 992);
const isMobileOpen = ref(false);
const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  isOpen: () => isMobile.value && isMobileOpen.value,
  onClose: closeMobileSidebar,
});

function closeMobileSidebar() {
  isMobileOpen.value = false;
}

function updateViewport() {
  isMobile.value = window.innerWidth < 992;
  if (!isMobile.value) closeMobileSidebar();
}

function navigate(action: () => void) {
  closeMobileSidebar();
  action();
}

onMounted(() => window.addEventListener("resize", updateViewport));
onBeforeUnmount(() => window.removeEventListener("resize", updateViewport));
watch(
  () => [props.currentUser?.id, props.activeChatId, props.activeProjectId, props.isChatRoute, props.isHomeRoute, props.isProjectsRoute, props.isWorkspaceRoute],
  closeMobileSidebar
);
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
const projectNames = computed(() => new Map(props.projects.map((project) => [project.id, project.name])));
// A chat is either in an expanded project or Recent, never duplicated in both.
const recentChats = computed(() => props.chats.filter((chat) =>
  !chat.projectId || !areProjectsOpen.value || !projectNames.value.has(chat.projectId) || !isProjectExpanded(chat.projectId)
));

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
  return (props.isProjectsRoute && props.activeProjectId === projectId) ||
    (props.isChatRoute && activeChatProjectId.value === projectId && !isProjectExpanded(projectId));
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
  <div class="sidebar-mobile-bar workspace-surface">
    <button
      class="btn btn-secondary"
      type="button"
      aria-controls="app-sidebar"
      :aria-expanded="isMobileOpen"
      @click="isMobileOpen = true"
    >
      <Icon name="menu" /> <span>{{ t("sidebar.nav.openNavigation") }}</span>
    </button>
    <button class="sidebar-mobile-brand" type="button" @click="navigate(() => emit('open-home'))">
      {{ t("app.brand.name") }}
    </button>
  </div>
  <div v-if="isMobile && isMobileOpen" class="sidebar-mobile-backdrop" aria-hidden="true" @click="closeMobileSidebar" />
  <aside
    id="app-sidebar"
    ref="dialogRef"
    class="sidebar workspace-surface"
    :class="{ 'sidebar--mobile-open': isMobile && isMobileOpen }"
    :role="isMobile && isMobileOpen ? 'dialog' : undefined"
    :aria-modal="isMobile && isMobileOpen ? true : undefined"
    :aria-label="t('sidebar.nav.navigation')"
    tabindex="-1"
    @keydown="isMobile && isMobileOpen && onDialogKeydown($event)"
  >
    <button class="sidebar-mobile-close ui-icon-btn" type="button" :aria-label="t('sidebar.nav.closeNavigation')" @click="closeMobileSidebar"><Icon name="close" /></button>
    <div class="brand">
      <button class="sidebar-brand-link" type="button" :aria-current="isHomeRoute ? 'page' : undefined" @click="navigate(() => emit('open-home'))">
        {{ t("app.brand.name") }}
      </button>
    </div>

    <nav class="sidebar-nav" :aria-label="t('sidebar.nav.navigation')">
      <SidebarNavItem
        icon="edit"
        :label="t('sidebar.nav.newChat')"
        :active="isChatRoute && activeChatId === null"
        @click="navigate(() => emit('new-chat'))"
      />
      <SidebarNavItem
        icon="file-text"
        :label="t('sidebar.nav.tests')"
        :active="isWorkspaceRoute"
        @click="navigate(() => emit('open-workspace'))"
      />
    </nav>

    <div class="sidebar-scroll">
      <section class="sidebar-section">
        <div class="sidebar-section-heading">
          <button class="sidebar-section-link" :class="{ active: isProjectsRoute && !activeProjectId }" type="button" @click="navigate(() => emit('open-projects'))">{{ t("sidebar.nav.projects") }}</button>
          <button class="sidebar-section-toggle sidebar-section-toggle--icon" type="button" :aria-label="t('sidebar.nav.toggleProjects')" :aria-expanded="areProjectsOpen" aria-controls="sidebar-projects" @click="areProjectsOpen = !areProjectsOpen">
            <span class="sidebar-section-chevron" aria-hidden="true">&rsaquo;</span>
          </button>
        </div>

        <div v-if="areProjectsOpen" id="sidebar-projects" class="sidebar-section-body">
          <SidebarNavItem icon="plus" :label="t('sidebar.nav.newProject')" @click="navigate(() => emit('new-project'))" />

          <div v-for="project in projects" :key="project.id" class="sidebar-project-group">
            <div
              class="ui-row ui-row--compact ui-row--interactive sidebar-project-row"
              :class="{ active: isProjectActive(project.id) }"
            >
              <button
                class="ui-row__button sidebar-project-toggle"
                type="button"
                :aria-current="isProjectsRoute && activeProjectId === project.id ? 'page' : undefined"
                @click="navigate(() => emit('open-project', project.id))"
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
                  :aria-label="t('sidebar.project.toggleChats', { project: project.name })"
                  :aria-expanded="isProjectExpanded(project.id)"
                  :disabled="!hasProjectChats(project.id)"
                  @click.stop="toggleProject(project.id)"
                >
                  <span class="sidebar-section-chevron" :class="{ 'sidebar-section-chevron--closed': !isProjectExpanded(project.id) }" aria-hidden="true">&rsaquo;</span>
                </button>
              </div>
            </div>

            <div v-if="isProjectExpanded(project.id)" class="sidebar-project-chats">
              <SidebarChatItem
                v-for="chat in getProjectChats(project.id)"
                :key="chat.id"
                :active="isChatRoute && chat.id === activeChatId"
                :chat="chat"
                :renaming="chat.id === renamingChatId"
                @cancel-rename="emit('cancel-rename')"
                @open-menu="(event, chatId) => emit('open-chat-menu', event, chatId)"
                @rename="(chatId, title) => emit('rename-chat', chatId, title)"
                @select="(chatId) => navigate(() => emit('select-chat', chatId))"
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
              :active="isChatRoute && chat.id === activeChatId"
              :chat="chat"
              :project-name="chat.projectId ? projectNames.get(chat.projectId) : undefined"
              :renaming="chat.id === renamingChatId"
              @cancel-rename="emit('cancel-rename')"
              @open-menu="(event, chatId) => emit('open-chat-menu', event, chatId)"
              @rename="(chatId, title) => emit('rename-chat', chatId, title)"
              @select="(chatId) => navigate(() => emit('select-chat', chatId))"
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
      @logout="navigate(() => emit('logout'))"
      @open-settings="navigate(() => emit('open-settings'))"
      @open-usage="navigate(() => emit('open-usage'))"
      @sign-in="navigate(() => emit('sign-in'))"
      @toggle-theme="emit('toggle-theme')"
    />
  </aside>
</template>
