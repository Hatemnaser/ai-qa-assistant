<script setup lang="ts">
import type { Chat, ExportFormat, MenuPosition } from "../types";

defineProps<{
  exportMenu: MenuPosition | null;
  exportMenuChat: Chat | null;
  menuChat: Chat | null;
  menuPosition: MenuPosition | null;
}>();

const emit = defineEmits<{
  "delete-chat": [chatId: string];
  "export-chat": [chat: Chat, format: ExportFormat];
  "open-export-submenu": [event: MouseEvent, chatId: string];
  "rename-chat": [chat: Chat];
}>();
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="menuPosition && menuChat"
      class="chat-dropdown-menu show"
      :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
      @click.stop
    >
      <li>
        <button class="dropdown-item" type="button" @click="emit('rename-chat', menuChat)">
          Rename
        </button>
      </li>
      <li class="chat-export-item" @mouseenter="emit('open-export-submenu', $event, menuChat.id)">
        <button class="dropdown-item" type="button">
          <span>Export</span><span aria-hidden="true">&rsaquo;</span>
        </button>
      </li>
      <li>
        <button class="dropdown-item dropdown-item-danger" type="button" @click="emit('delete-chat', menuChat.id)">
          Delete
        </button>
      </li>
    </ul>

    <ul
      v-if="exportMenu && exportMenuChat"
      class="chat-dropdown-menu chat-export-submenu show"
      :style="{ left: `${exportMenu.left}px`, top: `${exportMenu.top}px` }"
      @click.stop
    >
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'md')">
          MD
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'txt')">
          TXT
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'csv')">
          CSV
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-chat', exportMenuChat, 'json')">
          JSON
        </button>
      </li>
    </ul>
  </Teleport>
</template>
