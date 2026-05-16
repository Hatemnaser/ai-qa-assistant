import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";

import type { Chat, MenuPosition } from "../types";

export function useChatMenus(chats: Ref<Chat[]>) {
  const openChatMenu = ref<MenuPosition | null>(null);
  const openExportMenu = ref<MenuPosition | null>(null);

  const openMenuChat = computed(() =>
    openChatMenu.value ? chats.value.find((chat) => chat.id === openChatMenu.value?.chatId) || null : null
  );
  const openExportMenuChat = computed(() =>
    openExportMenu.value ? chats.value.find((chat) => chat.id === openExportMenu.value?.chatId) || null : null
  );

  onMounted(() => {
    document.addEventListener("click", closeChatMenus);
    document.addEventListener("scroll", closeChatMenus, true);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("click", closeChatMenus);
    document.removeEventListener("scroll", closeChatMenus, true);
  });

  function openChatMenuForChat(event: MouseEvent, chatId: string) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();

    if (openChatMenu.value?.chatId === chatId) {
      closeChatMenus();
      return;
    }

    openChatMenu.value = {
      chatId,
      left: rect.right + 8,
      top: rect.top,
    };
    openExportMenu.value = null;
  }

  function openExportSubmenu(event: MouseEvent, chatId: string) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();

    openExportMenu.value = {
      chatId,
      left: rect.right + 8,
      top: rect.top,
    };
  }

  function closeChatMenus() {
    openChatMenu.value = null;
    openExportMenu.value = null;
  }

  return {
    closeChatMenus,
    openChatMenu,
    openChatMenuForChat,
    openExportMenu,
    openExportMenuChat,
    openExportSubmenu,
    openMenuChat,
  };
}
