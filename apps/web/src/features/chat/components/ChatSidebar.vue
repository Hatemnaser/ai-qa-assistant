<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { AuthUser } from "../../auth/types";
import type { Project } from "../../projects/types";
import Icon from "../../../ui/Icon.vue";
import SidebarAccountMenu from "./SidebarAccountMenu.vue";
import ConversationSidebarContent from "./ConversationSidebarContent.vue";
import type { SidebarTestItem } from "../../test-sessions/navigation";
import SidebarNavItem from "./SidebarNavItem.vue";
import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { Chat, ChatUsageSummary, ExportFormat } from "../types";

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
  usageSummary?: ChatUsageSummary | null;
  usageLoading?: boolean;
  usageError?: string;
  projectLoadError?: string;
  isLoadingProjects?: boolean;
  beforeAdopt?: (id: string) => Promise<void>;
  moveSession?: (id: string, from: string, to: string) => Promise<void>;
  workView?: "conversations" | "tests";
  testSessions?: SidebarTestItem[];
  activeTestId?: string | null;
  isLoadingTests?: boolean;
  testLoadError?: string;
  qaProjectFilter?: string;
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
  "reload-usage": [];
  "open-workspace": [];
  "select-chat": [chatId: string];
  "sign-in": [];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
  "toggle-theme": [];
  "open-conversations": [];
  "new-test": [];
  "select-test": [item: SidebarTestItem];
  "reload-tests": [];
  "session-updated": [];
  "update:qa-project-filter": [projectId: string];
}>();

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
  () => [props.currentUser?.id, props.activeChatId, props.activeTestId, props.activeProjectId, props.isChatRoute, props.isHomeRoute, props.isProjectsRoute, props.isWorkspaceRoute, props.workView],
  closeMobileSidebar
);

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
    class="sidebar workspace-surface workspace-navigation"
    :class="{ 'sidebar--mobile-open': isMobile && isMobileOpen }"
    :role="isMobile && isMobileOpen ? 'dialog' : undefined"
    :aria-modal="isMobile && isMobileOpen ? true : undefined"
    :aria-label="t('sidebar.nav.navigation')"
    tabindex="-1"
    @keydown="isMobile && isMobileOpen && onDialogKeydown($event)"
  >
    <button class="sidebar-mobile-close ui-icon-btn" type="button" :aria-label="t('sidebar.nav.closeNavigation')" @click="closeMobileSidebar"><Icon name="close" /></button>
    <nav class="workspace-navigation__rail" :aria-label="t('sidebar.nav.navigation')">
      <button class="workspace-navigation__rail-button" type="button" :class="{ active: isHomeRoute || isChatRoute || isWorkspaceRoute }" :aria-current="isHomeRoute || isChatRoute || isWorkspaceRoute ? 'page' : undefined" :aria-label="t('sessionTools.navigation.sessions')" :title="t('sessionTools.navigation.sessions')" @click="navigate(() => emit('open-home'))"><Icon name="home" /><span class="workspace-navigation__rail-label">{{ t('sessionTools.navigation.sessions') }}</span></button>
      <button class="workspace-navigation__rail-button" type="button" :class="{ active: isProjectsRoute }" :aria-current="isProjectsRoute ? 'page' : undefined" :aria-label="t('sessionTools.navigation.projects')" :title="t('sessionTools.navigation.projects')" @click="navigate(() => emit('open-projects'))"><Icon name="folder" /><span class="workspace-navigation__rail-label">{{ t('sessionTools.navigation.projects') }}</span></button>
      <SidebarAccountMenu :usage-summary="usageSummary" :usage-loading="usageLoading" :usage-error="usageError" :current-user="currentUser" :theme-toggle-label="themeToggleLabel"
        @export-active-chat="emit('export-active-chat', $event)" @import-chat="emit('import-chat', $event)" @logout="navigate(() => emit('logout'))" @open-settings="navigate(() => emit('open-settings'))" @open-usage="navigate(() => emit('open-usage'))" @reload-usage="emit('reload-usage')" @sign-in="navigate(() => emit('sign-in'))" @toggle-theme="emit('toggle-theme')" />
    </nav>
    <div class="workspace-navigation__list">
    <div class="brand">
      <button class="sidebar-brand-link" type="button" :aria-current="isHomeRoute ? 'page' : undefined" @click="navigate(() => emit('open-home'))">
        {{ t("app.brand.name") }}
      </button>
    </div>

    <nav class="sidebar-nav" :aria-label="t('sidebar.nav.navigation')">
      <SidebarNavItem
        icon="edit"
        :label="t('workspaces.newSession')"
        :active="isChatRoute && activeChatId === null || isWorkspaceRoute && !activeTestId"
        @click="navigate(() => emit('new-chat'))"
      />
    </nav>

    <div class="sidebar-scroll">
      <ConversationSidebarContent :key="currentUser?.id || 'guest'"
        :chats="chats" :projects="projects" :tests="testSessions" :active-test-id="activeTestId"
        :before-adopt="beforeAdopt" :move-session="moveSession" :project-load-error="projectLoadError" :is-loading-projects="isLoadingProjects"
        :active-chat-id="activeChatId" :active-project-id="activeProjectId"
        :is-chat-route="isChatRoute" :is-workspace-route="isWorkspaceRoute" :is-projects-route="isProjectsRoute" :renaming-chat-id="renamingChatId"
        @navigate="closeMobileSidebar" @new-project="emit('new-project')" @open-projects="emit('open-projects')"
        @open-project="emit('open-project', $event)" @select-chat="emit('select-chat', $event)" @select-test="emit('select-test', $event)"
        @cancel-rename="emit('cancel-rename')" @rename-chat="(id, title) => emit('rename-chat', id, title)"
        @open-chat-menu="(event, id) => emit('open-chat-menu', event, id)"
        @session-updated="emit('session-updated')"
        @reload-projects="emit('reload-tests')"
      />
      <div v-if="isLoadingTests" class="sidebar-empty" role="status">{{ t('testSessions.nav.loading') }}</div>
      <div v-else-if="testLoadError" class="sidebar-empty" role="alert">{{ testLoadError }} <button type="button" class="btn btn-link" @click="emit('reload-tests')">{{ t('testSessions.nav.retry') }}</button></div>
    </div>
    </div>
  </aside>
</template>
