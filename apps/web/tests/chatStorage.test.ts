import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { STORAGE_KEYS } from "../src/features/chat/constants";
import {
  clearActiveChatId,
  createChat,
  getActiveChatId,
  loadChats,
  saveChats,
  setActiveChatId,
} from "../src/features/chat/chatStorage";

beforeEach(() => {
  installMemoryStorage();
});

describe("chat storage", () => {
  it("normalizes stored chats from legacy/localStorage data", () => {
    localStorage.setItem(
      STORAGE_KEYS.CHATS,
      JSON.stringify([
        {
          id: "chat-1",
          title: "Legacy chat",
          mode: "edge_cases",
          model: "gemini-2.5-flash-lite",
          messages: [
            {
              content: "hello",
              role: "assistant",
            },
          ],
        },
      ])
    );

    const [chat] = loadChats();

    assert.equal(chat?.id, "chat-1");
    assert.equal(chat?.title, "Legacy chat");
    assert.equal(chat?.messages[0]?.role, "assistant");
    assert.equal(chat?.messages[0]?.content, "hello");
    assert.equal(chat?.messages[0]?.mode, "edge_cases");
    assert.equal(chat?.messages[0]?.model, "gemini-2.5-flash-lite");
    assert.ok(chat?.createdAt);
    assert.ok(chat?.updatedAt);
  });

  it("returns an empty list when stored chat JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEYS.CHATS, "{not-json");

    assert.deepEqual(loadChats(), []);
  });

  it("saves chats and tracks the active chat id", () => {
    const chat = createChat({
      id: "chat-2",
      title: "Saved chat",
    });

    saveChats([chat]);
    setActiveChatId(chat.id);

    assert.equal(loadChats()[0]?.title, "Saved chat");
    assert.equal(getActiveChatId(), "chat-2");

    clearActiveChatId();

    assert.equal(getActiveChatId(), null);
  });
});

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
