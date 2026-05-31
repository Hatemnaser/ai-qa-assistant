import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ref } from "vue";

import { createChat, loadChats } from "../src/features/chat/chatStorage";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../src/features/chat/constants";
import { useStoredChats } from "../src/features/chat/composables/useStoredChats";

beforeEach(() => {
  installMemoryStorage();
});

describe("useStoredChats", () => {
  it("applies a pending project assignment to the next new chat", () => {
    const { selectedProjectId, storedChats } = createStoredChatsHarness();

    storedChats.assignActiveChatProject(" project-1 ");
    const chat = storedChats.ensureActiveChat();

    assert.equal(chat.projectId, "project-1");
    assert.equal(selectedProjectId.value, "project-1");
    assert.equal(loadChats()[0]?.projectId, "project-1");
  });

  it("updates and clears the active chat project assignment", () => {
    const { storedChats } = createStoredChatsHarness();

    storedChats.assignActiveChatProject("project-1");
    storedChats.ensureActiveChat();
    storedChats.assignActiveChatProject(null);

    assert.equal(storedChats.activeChat.value?.projectId, null);
    assert.equal(loadChats()[0]?.projectId, null);
  });

  it("assigns an existing inactive chat to a project without changing the active chat", () => {
    const { selectedProjectId, storedChats } = createStoredChatsHarness();
    const activeChat = createChat({ id: "chat-active", projectId: null });
    const targetChat = createChat({ id: "chat-target", projectId: null });

    storedChats.addChatAndSelect(activeChat);
    storedChats.addChatAndSelect(targetChat);
    storedChats.selectChat(activeChat.id);
    storedChats.assignChatProject(targetChat.id, " project-2 ");

    assert.equal(storedChats.activeChat.value?.id, activeChat.id);
    assert.equal(selectedProjectId.value, null);
    assert.equal(loadChats().find((chat) => chat.id === targetChat.id)?.projectId, "project-2");
  });
});

function createStoredChatsHarness() {
  const selectedProjectId = ref<string | null>(null);
  const storedChats = useStoredChats({
    clearSelectedAttachments: () => {},
    messageInput: ref(""),
    selectedMode: ref(DEFAULT_MODE),
    selectedModel: ref(DEFAULT_MODEL),
    selectedProjectId,
  });

  return {
    selectedProjectId,
    storedChats,
  };
}

function installMemoryStorage() {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });
}
