<script setup lang="ts">
import ChatComposer from "./features/chat/components/ChatComposer.vue";
import ChatContextMenus from "./features/chat/components/ChatContextMenus.vue";
import ChatDeleteModal from "./features/chat/components/ChatDeleteModal.vue";
import ChatMessages from "./features/chat/components/ChatMessages.vue";
import ChatSidebar from "./features/chat/components/ChatSidebar.vue";
import ChatTopbar from "./features/chat/components/ChatTopbar.vue";
import { useTheme } from "./features/chat/chatTheme";
import { useChatController } from "./features/chat/composables/useChatController";

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
  <div class="app">
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
  </div>

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
</template>
