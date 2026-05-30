<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { useAuthSession } from "./features/auth/composables/useAuthSession";
import ForgotPasswordPage from "./features/auth/pages/ForgotPasswordPage.vue";
import LoginPage from "./features/auth/pages/LoginPage.vue";
import RegisterPage from "./features/auth/pages/RegisterPage.vue";
import type { AuthUser } from "./features/auth/types";
import ProjectsPage from "./features/projects/ProjectsPage.vue";
import { fetchProjects } from "./features/projects/projectsApi";
import type { Project } from "./features/projects/types";
import SettingsPage from "./features/settings/SettingsPage.vue";
import { fetchUserSettings, updateUserSettings } from "./features/settings/settingsApi";
import type { UserSettings } from "./features/settings/types";
import UsagePage from "./features/usage/UsagePage.vue";
import ChatComposer from "./features/chat/components/ChatComposer.vue";
import ChatContextMenus from "./features/chat/components/ChatContextMenus.vue";
import ChatDeleteModal from "./features/chat/components/ChatDeleteModal.vue";
import GuestLimitModal from "./features/chat/components/GuestLimitModal.vue";
import ChatMessages from "./features/chat/components/ChatMessages.vue";
import ChatSidebar from "./features/chat/components/ChatSidebar.vue";
import ChatTopbar from "./features/chat/components/ChatTopbar.vue";
import {
  CHAT_PROJECT_FILTER_ALL,
  getProjectIdForNewChat,
  isProjectFilterAvailable,
  type ChatProjectFilter,
} from "./features/chat/chatProjectFilters";
import { useTheme } from "./features/chat/chatTheme";
import { useAccountChatSync } from "./features/chat/composables/useAccountChatSync";
import { useChatController } from "./features/chat/composables/useChatController";
import { useAppRoute, type AuthView } from "./router/useAppRoute";

const {
  currentRoute,
  navigateToAuth: navigateToAuthRoute,
  navigateToChat,
  navigateToProjects,
  navigateToSettings,
  navigateToUsage,
} = useAppRoute();
const { currentUser, loadCurrentUser, logoutCurrentUser, setAuthenticatedUser } = useAuthSession();
const isGuestLimitModalOpen = ref(false);
const accountSettings = ref<UserSettings | null>(null);
const accountProjects = ref<Project[]>([]);
const isLoadingProjects = ref(false);
const projectLoadError = ref("");
const selectedChatProjectFilter = ref<ChatProjectFilter>(CHAT_PROJECT_FILTER_ALL);

function navigateToAuth(view: AuthView) {
  isGuestLimitModalOpen.value = false;
  navigateToAuthRoute(view);
}

function handleAuthenticated(user: AuthUser) {
  setAuthenticatedUser(user);
  setChatStorageOwner(user.id, { adoptGuestChats: true });
  clearGuestLimitReached();
  isGuestLimitModalOpen.value = false;
  navigateToChat();
  void applyAccountSettings();
  void syncAccountChats();
}

function handleNewChat() {
  startNewChat();
  assignActiveChatProject(getProjectIdForNewChat(selectedChatProjectFilter.value));
  navigateToChat();
}

async function handleLogout() {
  await logoutCurrentUser(async () => {
    clearScheduledChatPersist();

    if (currentUser.value) {
      await persistAccountChats();
    }
  });
  setChatStorageOwner(null);
  accountSettings.value = null;
  accountProjects.value = [];
  projectLoadError.value = "";
  selectedChatProjectFilter.value = CHAT_PROJECT_FILTER_ALL;
  clearGuestLimitReached();
}

const {
  activeChatId,
  activeMessages,
  applyQuickAction,
  assignActiveChatProject,
  beginRenameChat,
  cancelDeleteChat,
  cancelRenameChat,
  chatPendingDelete,
  chats,
  clearGuestLimitReached,
  confirmDeleteChat,
  copyAnswer,
  exportActiveChat,
  exportAnswer,
  exportChat,
  handleAttachmentsSelected,
  handleImportChat,
  handleSubmit,
  guestLimitReached,
  isSending,
  loadAiModelCatalog,
  messageInput,
  modelOptions,
  openAttachment,
  openChatMenu,
  openChatMenuForChat,
  openExportMenu,
  openExportMenuChat,
  openExportSubmenu,
  openMenuChat,
  openSelectedAttachment,
  renamingChatId,
  requestDeleteChat,
  replaceChats,
  removeSelectedAttachment,
  selectChat,
  selectedAttachments,
  selectedMode,
  selectedModel,
  selectedProjectId,
  setChatStorageOwner,
  submitRenameChat,
  startNewChat,
  usageSummary,
} = useChatController();

const { clearScheduledChatPersist, deletePersistedChat, persistAccountChats, syncAccountChats } =
  useAccountChatSync({
    chats,
    currentUser,
    replaceChats,
  });
const { setTheme, theme, themeToggleLabel, toggleTheme } = useTheme();
const isGuestLimitBlocked = computed(() => !currentUser.value && guestLimitReached.value);

onMounted(() => {
  void loadAiModelCatalog();
  void initializeSession();
});

watch(isGuestLimitBlocked, (isBlocked) => {
  if (isBlocked) {
    isGuestLimitModalOpen.value = true;
  }
});

watch(
  () => currentUser.value?.id || null,
  () => void loadAccountProjects()
);

watch(currentRoute, (route) => {
  if (route === "chat") {
    void loadAccountProjects();
  }
});

async function initializeSession() {
  const user = await loadCurrentUser();

  setChatStorageOwner(user?.id || null);

  if (user) {
    await syncAccountChats();
    await applyAccountSettings();
  }
}

function confirmDeleteChatAndSync() {
  const deletedChatId = chatPendingDelete.value?.id;

  confirmDeleteChat();

  void deletePersistedChat(deletedChatId);
}

async function applyAccountSettings() {
  if (!currentUser.value) return;

  try {
    applySavedSettings(await fetchUserSettings());
  } catch {
    // Settings should not block chat startup.
  }
}

function handleSettingsSaved(settings: UserSettings) {
  applySavedSettings(settings);
}

function handleProjectsChanged(projects: Project[]) {
  accountProjects.value = [...projects];
  projectLoadError.value = "";

  if (selectedProjectId.value && !projects.some((project) => project.id === selectedProjectId.value)) {
    assignActiveChatProject(null);
  }

  if (!isProjectFilterAvailable(selectedChatProjectFilter.value, projects)) {
    selectedChatProjectFilter.value = CHAT_PROJECT_FILTER_ALL;
  }
}

function handleProjectFilterSelected(filter: ChatProjectFilter) {
  selectedChatProjectFilter.value = filter;
  navigateToChat();
}

async function loadAccountProjects() {
  const userId = currentUser.value?.id || null;
  projectLoadError.value = "";

  if (!userId) {
    accountProjects.value = [];
    isLoadingProjects.value = false;
    selectedChatProjectFilter.value = CHAT_PROJECT_FILTER_ALL;
    return;
  }

  isLoadingProjects.value = true;

  try {
    const projects = await fetchProjects();

    if (currentUser.value?.id !== userId) return;

    accountProjects.value = projects;

    if (!isProjectFilterAvailable(selectedChatProjectFilter.value, projects)) {
      selectedChatProjectFilter.value = CHAT_PROJECT_FILTER_ALL;
    }
  } catch (error) {
    if (currentUser.value?.id === userId) {
      projectLoadError.value = error instanceof Error ? error.message : "Could not load projects.";
    }
  } finally {
    if (!currentUser.value || currentUser.value.id === userId) {
      isLoadingProjects.value = false;
    }
  }
}

function applySavedSettings(settings: UserSettings) {
  accountSettings.value = settings;
  selectedModel.value = settings.defaultModel;
  setTheme(settings.theme);
}

function handleToggleTheme() {
  toggleTheme();
  void persistThemeSetting();
}

async function persistThemeSetting() {
  if (!currentUser.value) return;

  try {
    accountSettings.value = await updateUserSettings({
      defaultModel: accountSettings.value?.defaultModel || selectedModel.value,
      language: accountSettings.value?.language || "en",
      theme: theme.value,
    });
  } catch {
    // Local theme changes should still work if the account settings save fails.
  }
}
</script>

<template>
  <LoginPage
    v-if="currentRoute === 'login'"
    :theme-toggle-label="themeToggleLabel"
    @authenticated="handleAuthenticated"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <RegisterPage
    v-else-if="currentRoute === 'register'"
    :theme-toggle-label="themeToggleLabel"
    @authenticated="handleAuthenticated"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <ForgotPasswordPage
    v-else-if="currentRoute === 'forgot-password'"
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <div v-else class="app">
    <ChatSidebar
      :active-chat-id="activeChatId"
      :chats="chats"
      :current-user="currentUser"
      :is-chat-route="currentRoute === 'chat'"
      :is-projects-route="currentRoute === 'projects'"
      :project-filter="selectedChatProjectFilter"
      :projects="accountProjects"
      :renaming-chat-id="renamingChatId"
      :theme-toggle-label="themeToggleLabel"
      @cancel-rename="cancelRenameChat"
      @export-active-chat="exportActiveChat"
      @import-chat="handleImportChat"
      @logout="handleLogout"
      @new-chat="handleNewChat"
      @open-projects="navigateToProjects"
      @open-settings="navigateToSettings"
      @open-usage="navigateToUsage"
      @select-project-filter="handleProjectFilterSelected"
      @select-chat="selectChat"
      @sign-in="navigateToAuth('login')"
      @open-chat-menu="openChatMenuForChat"
      @rename-chat="submitRenameChat"
      @toggle-theme="handleToggleTheme"
    />

    <main v-if="currentRoute === 'usage'" class="chat-layout">
      <UsagePage @back-to-chat="navigateToChat" />
    </main>

    <main v-else-if="currentRoute === 'projects'" class="chat-layout">
      <ProjectsPage
        :current-user="currentUser"
        @back-to-chat="navigateToChat"
        @projects-changed="handleProjectsChanged"
        @sign-in="navigateToAuth('login')"
      />
    </main>

    <main v-else-if="currentRoute === 'settings'" class="chat-layout">
      <SettingsPage
        :current-user="currentUser"
        :model-options="modelOptions"
        @back-to-chat="navigateToChat"
        @settings-saved="handleSettingsSaved"
        @sign-in="navigateToAuth('login')"
      />
    </main>

    <main v-else class="chat-layout" :class="{ 'empty-chat': activeMessages.length === 0 }">
      <ChatTopbar
        v-model:mode="selectedMode"
        v-model:model="selectedModel"
        :is-loading-projects="isLoadingProjects"
        :model-options="modelOptions"
        :project-error="projectLoadError"
        :project-id="selectedProjectId"
        :projects="accountProjects"
        :show-project-selector="Boolean(currentUser)"
        :usage-summary="usageSummary"
        @open-projects="navigateToProjects"
        @update:project-id="assignActiveChatProject"
      />

      <ChatMessages
        :copy-answer="copyAnswer"
        :is-sending="isSending"
        :messages="activeMessages"
        @export-answer="exportAnswer"
        @open-attachment="openAttachment"
        @quick-action="applyQuickAction"
      />

      <ChatComposer
        v-model:message="messageInput"
        :disabled="isGuestLimitBlocked"
        disabled-message="Guest demo limit reached. Sign in or create a free account to continue."
        :is-sending="isSending"
        :mode="selectedMode"
        :selected-attachments="selectedAttachments"
        @attachments-selected="handleAttachmentsSelected"
        @disabled-click="isGuestLimitModalOpen = true"
        @open-selected-attachment="openSelectedAttachment"
        @quick-action="applyQuickAction"
        @remove-selected-attachment="removeSelectedAttachment"
        @submit="handleSubmit"
      />
    </main>

    <ChatContextMenus
      :export-menu="openExportMenu"
      :export-menu-chat="openExportMenuChat"
      :menu-chat="openMenuChat"
      :menu-position="openChatMenu"
      @delete-chat="requestDeleteChat"
      @export-chat="exportChat"
      @open-export-submenu="openExportSubmenu"
      @rename-chat="beginRenameChat"
    />

    <ChatDeleteModal :chat="chatPendingDelete" @cancel="cancelDeleteChat" @confirm="confirmDeleteChatAndSync" />
    <GuestLimitModal
      v-if="isGuestLimitBlocked && isGuestLimitModalOpen"
      @close="isGuestLimitModalOpen = false"
      @export-chat="exportActiveChat('json')"
      @register="navigateToAuth('register')"
      @sign-in="navigateToAuth('login')"
    />
  </div>
</template>
