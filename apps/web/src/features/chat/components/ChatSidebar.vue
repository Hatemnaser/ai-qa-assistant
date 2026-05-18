<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ComponentPublicInstance } from "vue";

import type { Chat } from "../types";

const props = defineProps<{
  activeChatId: string | null;
  chats: Chat[];
  renamingChatId: string | null;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "new-chat": [];
  "select-chat": [chatId: string];
  "open-chat-menu": [event: MouseEvent, chatId: string];
  "rename-chat": [chatId: string, title: string];
}>();

const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
const skipNextRenameBlur = ref(false);

watch(
  () => props.renamingChatId,
  async (chatId) => {
    skipNextRenameBlur.value = false;

    if (!chatId) return;

    const chat = props.chats.find((item) => item.id === chatId);
    renameDraft.value = chat?.title || "";

    await nextTick();
    renameInput.value?.focus();
    renameInput.value?.select();
  }
);

function isRenaming(chat: Chat) {
  return chat.id === props.renamingChatId;
}

function setRenameInput(element: Element | ComponentPublicInstance | null) {
  renameInput.value = element instanceof HTMLInputElement ? element : null;
}

function submitRename(chat: Chat) {
  skipNextRenameBlur.value = true;
  emit("rename-chat", chat.id, renameDraft.value);
}

function cancelRename(chat: Chat) {
  skipNextRenameBlur.value = true;
  renameDraft.value = chat.title;
  emit("cancel-rename");
}

function handleRenameBlur(chat: Chat) {
  if (skipNextRenameBlur.value) {
    skipNextRenameBlur.value = false;
    return;
  }

  submitRename(chat);
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <h1>AI QA Assistant</h1>
      <p>QA workspace for test cases, bug reports, edge cases, and checklists.</p>
    </div>

    <nav class="sidebar-nav" aria-label="Workspace">
      <button
        class="sidebar-nav-item"
        :class="{ active: activeChatId === null }"
        type="button"
        @click="emit('new-chat')"
      >
        <span class="sidebar-nav-icon" aria-hidden="true">+</span>
        <span>New Chat</span>
      </button>

      <button class="sidebar-nav-item" type="button">
        <span class="sidebar-nav-icon sidebar-nav-icon-search" aria-hidden="true"></span>
        <span>Search</span>
      </button>

      <button class="sidebar-nav-item" type="button">
        <span class="sidebar-nav-icon sidebar-nav-icon-project" aria-hidden="true"></span>
        <span>Projects</span>
      </button>
    </nav>

    <div class="sidebar-section">
      <div class="sidebar-title">Recent Chats</div>

      <div class="chat-list">
        <div
          v-for="chat in chats"
          :key="chat.id"
          class="chat-list-item"
          :class="{ active: chat.id === activeChatId }"
        >
          <button
            v-if="!isRenaming(chat)"
            class="chat-title-btn"
            type="button"
            @click="emit('select-chat', chat.id)"
          >
            <span class="chat-title-text">{{ chat.title }}</span>
          </button>
          <input
            v-else
            :ref="setRenameInput"
            v-model="renameDraft"
            class="chat-rename-input"
            type="text"
            @blur="handleRenameBlur(chat)"
            @keydown.enter.prevent="submitRename(chat)"
            @keydown.escape.prevent="cancelRename(chat)"
          />

          <div class="chat-menu">
            <button
              class="chat-menu-btn"
              type="button"
              aria-label="Chat options"
              @click.stop="emit('open-chat-menu', $event, chat.id)"
            >
              &hellip;
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
