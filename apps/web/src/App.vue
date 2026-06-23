<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { useAuthSession } from "./features/auth/composables/useAuthSession";
import ForgotPasswordPage from "./features/auth/pages/ForgotPasswordPage.vue";
import LoginPage from "./features/auth/pages/LoginPage.vue";
import RegisterPage from "./features/auth/pages/RegisterPage.vue";
import VerifyEmailPage from "./features/auth/pages/VerifyEmailPage.vue";
import type { AuthUser } from "./features/auth/types";
import ProjectFormModal from "./features/projects/components/ProjectFormModal.vue";
import ProjectsPage from "./features/projects/ProjectsPage.vue";
import { createProject, fetchProjects } from "./features/projects/projectsApi";
import type { Project, ProjectInput } from "./features/projects/types";
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
import { useTheme } from "./features/chat/chatTheme";
import { useAccountChatSync } from "./features/chat/composables/useAccountChatSync";
import { useChatController } from "./features/chat/composables/useChatController";
import { useI18n } from "./i18n/useI18n";
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
const projectToOpenId = ref<string | null>(null);
const chatPendingProjectCreate = ref<string | null>(null);
const isProjectCreateModalOpen = ref(false);
const isCreatingProject = ref(false);
const projectCreateModalError = ref("");

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
  navigateToChat();
}

function handleSidebarChatSelected(chatId: string) {
  selectChat(chatId);
  navigateToChat();
}

function handleOpenProjects() {
  chatPendingProjectCreate.value = null;
  projectToOpenId.value = null;
  navigateToProjects();
}

function handleNewProject() {
  openGlobalProjectCreateModal(null);
}

function handleOpenProject(projectId: string) {
  chatPendingProjectCreate.value = null;
  projectToOpenId.value = projectId;
  navigateToProjects();
}

function handleCreateProjectForChat(chatId: string) {
  closeChatMenus();
  openGlobalProjectCreateModal(chatId);
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
  closeGlobalProjectCreateModal();
  projectLoadError.value = "";
  clearGuestLimitReached();
}

const {
  activeChat,
  activeChatId,
  activeMessages,
  applyQuickAction,
  assignActiveChatProject,
  assignChatProject,
  beginRenameChat,
  cancelDeleteChat,
  cancelRenameChat,
  chatPendingDelete,
  chats,
  closeChatMenus,
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
  openProjectMenu,
  openProjectMenuChat,
  openProjectSubmenu,
  openSelectedAttachment,
  prepareNewChatForProject,
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
const { locale, setLocale, t } = useI18n();
const isGuestLimitBlocked = computed(() => !currentUser.value && guestLimitReached.value);
const sidebarActiveProjectId = computed(() => (currentRoute.value === "projects" ? projectToOpenId.value : null));

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
  clearUnavailableProjectAssignments(projects);
}

function openGlobalProjectCreateModal(chatId: string | null) {
  if (!currentUser.value) {
    chatPendingProjectCreate.value = null;
    navigateToAuth("login");
    return;
  }

  chatPendingProjectCreate.value = chatId;
  projectCreateModalError.value = "";
  isProjectCreateModalOpen.value = true;
}

function closeGlobalProjectCreateModal() {
  if (isCreatingProject.value) return;

  isProjectCreateModalOpen.value = false;
  chatPendingProjectCreate.value = null;
  projectCreateModalError.value = "";
}

async function handleGlobalProjectCreate(input: ProjectInput) {
  if (!currentUser.value) {
    closeGlobalProjectCreateModal();
    navigateToAuth("login");
    return;
  }

  isCreatingProject.value = true;
  projectCreateModalError.value = "";

  try {
    const project = await createProject(input);
    const pendingChatId = chatPendingProjectCreate.value;

    accountProjects.value = [project, ...accountProjects.value.filter((item) => item.id !== project.id)];

    if (pendingChatId) {
      assignChatProject(pendingChatId, project.id);
    }

    isProjectCreateModalOpen.value = false;
    chatPendingProjectCreate.value = null;
    projectToOpenId.value = project.id;
    navigateToProjects();
  } catch (error) {
    projectCreateModalError.value = error instanceof Error ? error.message : "Could not create this project.";
  } finally {
    isCreatingProject.value = false;
  }
}

function handleProjectChatSelected(chatId: string) {
  selectChat(chatId);
  navigateToChat();
}

function handleAddChatsToProject(chatIds: string[], projectId: string) {
  for (const chatId of chatIds) {
    assignChatProject(chatId, projectId);
  }

  projectToOpenId.value = projectId;
}

function handleProjectMessageSubmit(projectId: string) {
  const hasDraft = Boolean(messageInput.value.trim() || selectedAttachments.value.length);

  if (!hasDraft || isSending.value) {
    void handleSubmit();
    return;
  }

  prepareNewChatForProject(projectId);
  void handleSubmit();
  navigateToChat();
}

async function loadAccountProjects() {
  const userId = currentUser.value?.id || null;
  projectLoadError.value = "";

  if (!userId) {
    accountProjects.value = [];
    isLoadingProjects.value = false;
    return;
  }

  isLoadingProjects.value = true;

  try {
    const projects = await fetchProjects();

    if (currentUser.value?.id !== userId) return;

    accountProjects.value = projects;
    clearUnavailableProjectAssignments(projects);
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

function clearUnavailableProjectAssignments(projects: Project[]) {
  const projectIds = new Set(projects.map((project) => project.id));

  if (selectedProjectId.value && !projectIds.has(selectedProjectId.value)) {
    assignActiveChatProject(null);
  }

  for (const chat of chats.value) {
    if (chat.projectId && !projectIds.has(chat.projectId)) {
      assignChatProject(chat.id, null);
    }
  }
}

function applySavedSettings(settings: UserSettings) {
  accountSettings.value = settings;
  selectedModel.value = settings.defaultModel;
  setLocale(settings.language);
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
      language: accountSettings.value?.language || locale.value,
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
    @back-to-chat="navigateToChat"
    @navigate="navigateToAuth"
    @toggle-theme="toggleTheme"
  />

  <VerifyEmailPage
    v-else-if="currentRoute === 'verify-email'"
    :theme-toggle-label="themeToggleLabel"
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
      :active-project-id="sidebarActiveProjectId"
      :chats="chats"
      :current-user="currentUser"
      :is-chat-route="currentRoute === 'chat'"
      :is-projects-route="currentRoute === 'projects'"
      :projects="accountProjects"
      :renaming-chat-id="renamingChatId"
      :theme-toggle-label="themeToggleLabel"
      @cancel-rename="cancelRenameChat"
      @export-active-chat="exportActiveChat"
      @import-chat="handleImportChat"
      @logout="handleLogout"
      @new-chat="handleNewChat"
      @new-project="handleNewProject"
      @open-project="handleOpenProject"
      @open-projects="handleOpenProjects"
      @open-settings="navigateToSettings"
      @open-usage="navigateToUsage"
      @select-chat="handleSidebarChatSelected"
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
        v-model:message="messageInput"
        :chats="chats"
        :current-user="currentUser"
        :disabled="isGuestLimitBlocked"
        :disabled-message="t('errors.guestLimit')"
        :is-sending="isSending"
        :mode="selectedMode"
        :project-to-open-id="projectToOpenId"
        :selected-attachments="selectedAttachments"
        @active-project-changed="projectToOpenId = $event"
        @add-chats-to-project="handleAddChatsToProject"
        @attachments-selected="handleAttachmentsSelected"
        @disabled-click="isGuestLimitModalOpen = true"
        @open-chat="handleProjectChatSelected"
        @open-selected-attachment="openSelectedAttachment"
        @projects-changed="handleProjectsChanged"
        @quick-action="applyQuickAction"
        @remove-selected-attachment="removeSelectedAttachment"
        @sign-in="navigateToAuth('login')"
        @submit-project-message="handleProjectMessageSubmit"
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
        :chat-title="activeChat?.title"
        v-model:mode="selectedMode"
        v-model:model="selectedModel"
        :is-loading-projects="isLoadingProjects"
        :model-options="modelOptions"
        :project-error="projectLoadError"
        :project-id="selectedProjectId"
        :projects="accountProjects"
        :usage-summary="usageSummary"
        @open-projects="handleOpenProjects"
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
        :disabled-message="t('errors.guestLimit')"
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
      :project-menu="openProjectMenu"
      :project-menu-chat="openProjectMenuChat"
      :projects="accountProjects"
      @assign-chat-project="assignChatProject"
      @create-project-for-chat="handleCreateProjectForChat"
      @delete-chat="requestDeleteChat"
      @export-chat="exportChat"
      @open-export-submenu="openExportSubmenu"
      @open-project-submenu="openProjectSubmenu"
      @rename-chat="beginRenameChat"
    />

    <ProjectFormModal
      :error-message="projectCreateModalError"
      :is-open="isProjectCreateModalOpen"
      :is-saving="isCreatingProject"
      :project="null"
      @cancel="closeGlobalProjectCreateModal"
      @save="handleGlobalProjectCreate"
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
