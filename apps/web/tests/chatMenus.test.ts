import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";

import { createChat } from "../src/features/chat/chatStorage";
import { getChatMenuPosition, type useChatMenus } from "../src/features/chat/composables/useChatMenus";

const menuSource = await readFile(new URL("../src/features/chat/composables/useChatMenus.ts", import.meta.url), "utf8");
const menuScript = transpileModule(menuSource, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;

describe("chat menu placement", () => {
  it("prefers the outside edge in LTR and RTL then flips at viewport boundaries", () => {
    const size = { width: 200, height: 160 };
    const viewport = { width: 1024, height: 768 };
    assert.deepEqual(getChatMenuPosition({ left: 240, right: 264, top: 50 }, size, viewport), { left: 272, top: 50 });
    assert.deepEqual(getChatMenuPosition({ left: 740, right: 764, top: 50 }, size, viewport, true), { left: 532, top: 50 });
    assert.deepEqual(getChatMenuPosition({ left: 950, right: 974, top: 50 }, size, viewport), { left: 742, top: 50 });
    assert.deepEqual(getChatMenuPosition({ left: 20, right: 44, top: 50 }, size, viewport, true), { left: 52, top: 50 });
  });

  it("clamps small-screen menus, including bottom edges and tall project lists", () => {
    for (const rtl of [true, false]) {
      const result = getChatMenuPosition({ left: 150, right: 180, top: 600 }, { width: 300, height: 500 }, { width: 320, height: 640 }, rtl);
      assert.equal(result.top, 132);
      assert.ok(result.left >= 8 && result.left + 300 <= 312);
      assert.deepEqual(getChatMenuPosition({ left: 0, right: 20, top: -100 }, { width: 110, height: 200 }, { width: 320, height: 640 }, rtl).top, 8);
    }
  });

  it("preserves all actions and formats through actual click/touch submenu buttons", async () => {
    const source = await readFile(new URL("../src/features/chat/components/ChatContextMenus.vue", import.meta.url), "utf8");
    assert.doesNotMatch(source, /@mouseenter/);
    for (const kind of ["project", "export"]) {
      assert.ok(source.includes(`@click="emit('open-${kind}-submenu', $event, menuChat.id)"`));
      assert.ok(source.includes(`id="chat-${kind}-menu"`));
    }
    for (const format of ["md", "txt", "csv", "json"]) {
      assert.ok(source.includes(`emit('export-chat', exportMenuChat, '${format}')`));
    }
    for (const action of ["rename-chat", "assign-chat-project", "create-project-for-chat", "delete-chat"]) {
      assert.ok(source.includes(`emit('${action}'`));
    }
    assert.equal((source.match(/@keydown="onMenuKeydown"/g) || []).length, 3);
    assert.match(source, /role="menuitem"/);
  });
});

describe("chat menu keyboard and dismissal lifecycle", () => {
  it("opens, focuses and measures menus; Escape returns through submenu and then original trigger", async () => {
    const harness = mountMenus();
    try {
      const { menus, trigger, submenuTrigger, document, event } = harness;
      menus.openChatMenuForChat(event(trigger), "chat-1");
      await vue.nextTick();
      assert.equal(document.activeElement, harness.mainItem);
      assert.equal(trigger.attributes.get("aria-expanded"), "true");
      assert.equal(menus.openMenuChat.value?.id, "chat-1");
      menus.openExportSubmenu(event(submenuTrigger), "chat-1");
      await vue.nextTick();
      assert.equal(document.activeElement, harness.submenuItem);
      assert.ok(menus.openExportMenu.value);
      harness.key("Escape");
      assert.equal(menus.openExportMenu.value, null);
      assert.ok(menus.openChatMenu.value);
      assert.equal(document.activeElement, submenuTrigger);
      harness.key("Escape");
      assert.equal(menus.openChatMenu.value, null);
      assert.equal(document.activeElement, trigger);
      assert.equal(trigger.attributes.has("aria-expanded"), false);
    } finally { harness.cleanup(); }
  });

  it("uses the RTL back arrow, lets internal lists scroll, and dismisses without stealing outside focus", async () => {
    const harness = mountMenus("rtl");
    try {
      const { menus, trigger, submenuTrigger, event } = harness;
      menus.openChatMenuForChat(event(trigger), "chat-1");
      await vue.nextTick();
      menus.openProjectSubmenu(event(submenuTrigger), "chat-1");
      await vue.nextTick();
      harness.dispatch("scroll", { target: harness.menuElement });
      assert.ok(menus.openProjectMenu.value);
      harness.key("ArrowRight");
      assert.equal(menus.openProjectMenu.value, null);
      assert.equal(harness.document.activeElement, submenuTrigger);
      harness.key("Escape", true);
      assert.ok(menus.openChatMenu.value, "IME Escape must not dismiss");
      harness.document.activeElement = harness.outside;
      harness.dispatch("click", { target: harness.outside });
      assert.equal(menus.openChatMenu.value, null);
      assert.equal(harness.document.activeElement, harness.outside);
    } finally { harness.cleanup(); }
  });

  it("does not focus a menu after it closed before rendering and closes for Tab/resize", async () => {
    const harness = mountMenus();
    try {
      harness.document.activeElement = harness.trigger;
      harness.menus.openChatMenuForChat(harness.event(harness.trigger), "chat-1");
      harness.menus.closeChatMenus();
      await vue.nextTick();
      assert.equal(harness.document.activeElement, harness.trigger);
      harness.menus.openChatMenuForChat(harness.event(harness.trigger), "chat-1");
      await vue.nextTick();
      harness.key("Tab");
      assert.equal(harness.menus.openChatMenu.value, null);
      assert.equal(harness.document.activeElement, harness.trigger);
      harness.menus.openChatMenuForChat(harness.event(harness.trigger), "chat-1");
      harness.dispatch("resize", {});
      assert.equal(harness.menus.openChatMenu.value, null);
    } finally { harness.cleanup(); }
  });
});

function mountMenus(direction = "ltr") {
  const handlers = new Map<string, (event: unknown) => void>();
  const releases: (() => void)[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(["window", "document", "Element"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = {
    activeElement: null as FakeElement | null,
    documentElement: { dir: direction },
    addEventListener(key: string, fn: (event: unknown) => void) { handlers.set(key, fn); },
    removeEventListener(key: string) { handlers.delete(key); },
    getElementById(id: string) { return elements.get(id) || null; },
  };
  class FakeElement {
    isConnected = true;
    attributes = new Map<string, string>();
    constructor(readonly isMenu = false, readonly firstItem: FakeElement | null = null) {}
    getBoundingClientRect() { return { left: 270, right: 294, top: 620, width: 200, height: 180 }; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    focus() { document.activeElement = this; }
    closest() { return this.isMenu ? this : null; }
    querySelector() { return this.firstItem; }
  }
  const trigger = new FakeElement();
  const submenuTrigger = new FakeElement(true);
  const mainItem = new FakeElement(true);
  const submenuItem = new FakeElement(true);
  const menuElement = new FakeElement(true, mainItem);
  const outside = new FakeElement();
  const elements = new Map([
    ["chat-actions-menu", menuElement],
    ["chat-project-menu", new FakeElement(true, submenuItem)],
    ["chat-export-menu", new FakeElement(true, submenuItem)],
  ]);
  globals.document = document;
  globals.window = { innerWidth: 320, innerHeight: 640, getComputedStyle: () => ({ direction }), addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  globals.Element = FakeElement;
  const exports = {} as { useChatMenus: typeof useChatMenus };
  new Function("require", "exports", menuScript)((id: string) => {
    assert.equal(id, "vue");
    return { ...vue, onMounted: (fn: () => void) => fn(), onBeforeUnmount: (fn: () => void) => releases.push(fn) };
  }, exports);
  const menus = exports.useChatMenus(vue.ref([createChat({ id: "chat-1" })]));
  const dispatch = (key: string, event: unknown) => handlers.get(key)?.(event);
  return {
    menus, trigger, submenuTrigger, mainItem, submenuItem, menuElement, outside, document, dispatch,
    event: (target: FakeElement) => ({ currentTarget: target } as unknown as MouseEvent),
    key: (key: string, isComposing = false) => dispatch("keydown", { key, isComposing, defaultPrevented: false, preventDefault() {}, stopPropagation() {} }),
    cleanup() {
      releases.forEach((fn) => fn());
      for (const [key, value] of previous) {
        if (value) Object.defineProperty(globalThis, key, value);
        else delete globals[key];
      }
    },
  };
}
