import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";

import type { Chat, MenuPosition } from "../types";

type MenuAnchor = { left: number; right: number; top: number };

/** Prefer the reading-direction side of the trigger, flip, then clamp both axes. */
export function getChatMenuPosition(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl = false
) {
  const gap = 8;
  const preferred = rtl ? anchor.left - size.width - gap : anchor.right + gap;
  const flipped = rtl ? anchor.right + gap : anchor.left - size.width - gap;
  const fits = (left: number) => left >= gap && left + size.width <= viewport.width - gap;
  return {
    left: Math.max(gap, Math.min(fits(preferred) ? preferred : flipped, viewport.width - size.width - gap)),
    top: Math.max(gap, Math.min(anchor.top, viewport.height - size.height - gap)),
  };
}

export function useChatMenus(chats: Ref<Chat[]>) {
  const openChatMenu = ref<MenuPosition | null>(null);
  const openExportMenu = ref<MenuPosition | null>(null);
  const openProjectMenu = ref<MenuPosition | null>(null);
  let menuTrigger: HTMLElement | null = null;
  let submenuTrigger: HTMLElement | null = null;
  let positionRevision = 0;

  const openMenuChat = computed(() =>
    openChatMenu.value ? chats.value.find((chat) => chat.id === openChatMenu.value?.chatId) || null : null
  );
  const openExportMenuChat = computed(() =>
    openExportMenu.value ? chats.value.find((chat) => chat.id === openExportMenu.value?.chatId) || null : null
  );
  const openProjectMenuChat = computed(() =>
    openProjectMenu.value ? chats.value.find((chat) => chat.id === openProjectMenu.value?.chatId) || null : null
  );

  onMounted(() => {
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", closeChatMenus);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("click", onOutsideClick);
    document.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", closeChatMenus);
    closeChatMenus();
  });

  function onOutsideClick(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest(".chat-dropdown-menu")) return;
    closeChatMenus();
  }
  function onScroll(event: Event) {
    // Long project lists remain scrollable without dismissing their menu.
    if (event.target instanceof Element && event.target.closest(".chat-dropdown-menu")) return;
    closeChatMenus();
  }
  function restoreFocus(element: HTMLElement | null) {
    if (element?.isConnected) element.focus({ preventScroll: true });
  }
  function onKeydown(event: KeyboardEvent) {
    if (!openChatMenu.value || event.isComposing || event.defaultPrevented) return;
    const hasSubmenu = Boolean(openExportMenu.value || openProjectMenu.value);
    const backKey = document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (event.key === "Escape" || (hasSubmenu && event.key === backKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (hasSubmenu) {
        positionRevision += 1;
        openExportMenu.value = null;
        openProjectMenu.value = null;
        restoreFocus(submenuTrigger);
        submenuTrigger = null;
      } else {
        const trigger = menuTrigger;
        closeChatMenus();
        restoreFocus(trigger);
      }
    } else if (event.key === "Tab") {
      const trigger = menuTrigger;
      closeChatMenus();
      restoreFocus(trigger);
      // Keep normal Tab/Shift+Tab movement from the original trigger.
    }
  }
  function positionFor(button: HTMLElement, width = 240, height = 240) {
    return getChatMenuPosition(button.getBoundingClientRect(), { width, height },
      { width: window.innerWidth, height: window.innerHeight },
      window.getComputedStyle(button).direction === "rtl");
  }
  async function fitAndFocus(menu: Ref<MenuPosition | null>, button: HTMLElement, id: string) {
    const revision = ++positionRevision;
    await nextTick();
    if (!menu.value || revision !== positionRevision) return;
    const element = document.getElementById(id);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    menu.value = { ...menu.value, ...positionFor(button, rect.width, rect.height) };
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  function openChatMenuForChat(event: MouseEvent, chatId: string) {
    const button = event.currentTarget as HTMLElement;
    if (openChatMenu.value?.chatId === chatId) {
      closeChatMenus();
      return;
    }
    menuTrigger?.removeAttribute("aria-expanded");
    menuTrigger = button;
    menuTrigger.setAttribute("aria-expanded", "true");
    openChatMenu.value = { chatId, ...positionFor(button) };
    openExportMenu.value = null;
    openProjectMenu.value = null;
    void fitAndFocus(openChatMenu, button, "chat-actions-menu");
  }
  function openExportSubmenu(event: MouseEvent, chatId: string) {
    const button = event.currentTarget as HTMLElement;
    submenuTrigger = button;
    openExportMenu.value = { chatId, ...positionFor(button, 110, 180) };
    openProjectMenu.value = null;
    void fitAndFocus(openExportMenu, button, "chat-export-menu");
  }
  function openProjectSubmenu(event: MouseEvent, chatId: string) {
    const button = event.currentTarget as HTMLElement;
    submenuTrigger = button;
    openProjectMenu.value = { chatId, ...positionFor(button) };
    openExportMenu.value = null;
    void fitAndFocus(openProjectMenu, button, "chat-project-menu");
  }
  function closeChatMenus() {
    positionRevision += 1;
    menuTrigger?.removeAttribute("aria-expanded");
    menuTrigger = null;
    submenuTrigger = null;
    openChatMenu.value = null;
    openExportMenu.value = null;
    openProjectMenu.value = null;
  }
  return {
    closeChatMenus, openChatMenu, openChatMenuForChat, openExportMenu, openExportMenuChat,
    openExportSubmenu, openMenuChat, openProjectMenu, openProjectMenuChat, openProjectSubmenu,
  };
}
