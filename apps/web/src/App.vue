<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import ForgotPasswordPage from "./features/auth/pages/ForgotPasswordPage.vue";
import LoginPage from "./features/auth/pages/LoginPage.vue";
import RegisterPage from "./features/auth/pages/RegisterPage.vue";
import ChatComposer from "./features/chat/components/ChatComposer.vue";
import ChatContextMenus from "./features/chat/components/ChatContextMenus.vue";
import ChatDeleteModal from "./features/chat/components/ChatDeleteModal.vue";
import ChatMessages from "./features/chat/components/ChatMessages.vue";
import ChatSidebar from "./features/chat/components/ChatSidebar.vue";
import ChatTopbar from "./features/chat/components/ChatTopbar.vue";
import { useTheme } from "./features/chat/chatTheme";
import { useChatController } from "./features/chat/composables/useChatController";

type AuthView = "login" | "register" | "forgot-password";
type AppRoute = "chat" | AuthView;

const authRoutes = new Set<AuthView>(["login", "register", "forgot-password"]);

function readRoute(): AppRoute {
  const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];

  return authRoutes.has(route as AuthView) ? (route as AuthView) : "chat";
}

const currentRoute = ref<AppRoute>(readRoute());

function syncRoute() {
  currentRoute.value = readRoute();
}

function navigateToAuth(view: AuthView) {
  window.location.hash = `/${view}`;
}

function navigateToChat() {
  window.location.hash = "/";
}

onMounted(() => {
  window.addEventListener("hashchange", syncRoute);
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", syncRoute);
});

const {
  activeChatId,
  activeMessages,
  applyQuickAction,
  beginRenameChat,
  cancelDeleteChat,
  cancelRenameChat,
  chatPendingDelete,
  chats,
  clearSelectedImage,
  confirmDeleteChat,
  copyAnswer,
  exportActiveChat,
  exportAnswer,
  exportChat,
  handleImageSelected,
  handleImportChat,
  handleSubmit,
  isSending,
  messageInput,
  openAttachment,
  openChatMenu,
  openChatMenuForChat,
  openExportMenu,
  openExportMenuChat,
  openExportSubmenu,
  openMenuChat,
  openSelectedImage,
  renamingChatId,
  requestDeleteChat,
  selectChat,
  selectedImage,
  selectedMode,
  selectedModel,
  submitRenameChat,
  startNewChat,
} = useChatController();

const { themeToggleLabel, toggleTheme } = useTheme();
</script>

<template>
  <LoginPage
    v-if="currentRoute === 'login'"
    :theme-toggle-label="themeToggleLabel"
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
      :renaming-chat-id="renamingChatId"
      @cancel-rename="cancelRenameChat"
      @new-chat="startNewChat"
      @select-chat="selectChat"
      @open-chat-menu="openChatMenuForChat"
      @rename-chat="submitRenameChat"
    />

    <main class="chat-layout" :class="{ 'empty-chat': activeMessages.length === 0 }">
      <ChatTopbar
        v-model:mode="selectedMode"
        v-model:model="selectedModel"
        :theme-toggle-label="themeToggleLabel"
        @export-active-chat="exportActiveChat"
        @import-chat="handleImportChat"
        @toggle-theme="toggleTheme"
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
        :is-sending="isSending"
        :mode="selectedMode"
        :selected-image="selectedImage"
        @clear-selected-image="clearSelectedImage"
        @image-selected="handleImageSelected"
        @open-selected-image="openSelectedImage"
        @quick-action="applyQuickAction"
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

    <ChatDeleteModal :chat="chatPendingDelete" @cancel="cancelDeleteChat" @confirm="confirmDeleteChat" />
  </div>
</template>
