<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { useAuthSession } from "./features/auth/composables/useAuthSession";
import ForgotPasswordPage from "./features/auth/pages/ForgotPasswordPage.vue";
import LoginPage from "./features/auth/pages/LoginPage.vue";
import RegisterPage from "./features/auth/pages/RegisterPage.vue";
import type { AuthUser } from "./features/auth/types";
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
import { useAppRoute, type AuthView } from "./router/useAppRoute";

const {
  currentRoute,
  navigateToAuth: navigateToAuthRoute,
  navigateToChat,
  navigateToSettings,
  navigateToUsage,
} = useAppRoute();
const { currentUser, loadCurrentUser, logoutCurrentUser, setAuthenticatedUser } = useAuthSession();
const isGuestLimitModalOpen = ref(false);
const accountSettings = ref<UserSettings | null>(null);

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

async function handleLogout() {
  await logoutCurrentUser(async () => {
    clearScheduledChatPersist();

    if (currentUser.value) {
      await persistAccountChats();
    }
  });
  setChatStorageOwner(null);
  accountSettings.value = null;
  clearGuestLimitReached();
}

const {
  activeChatId,
  activeMessages,
  applyQuickAction,
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
      :renaming-chat-id="renamingChatId"
      :theme-toggle-label="themeToggleLabel"
      @cancel-rename="cancelRenameChat"
      @export-active-chat="exportActiveChat"
      @import-chat="handleImportChat"
      @logout="handleLogout"
      @new-chat="startNewChat"
      @open-settings="navigateToSettings"
      @open-usage="navigateToUsage"
      @select-chat="selectChat"
      @sign-in="navigateToAuth('login')"
      @open-chat-menu="openChatMenuForChat"
      @rename-chat="submitRenameChat"
      @toggle-theme="handleToggleTheme"
    />

    <main v-if="currentRoute === 'usage'" class="chat-layout">
      <UsagePage @back-to-chat="navigateToChat" />
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
        :model-options="modelOptions"
        :usage-summary="usageSummary"
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
