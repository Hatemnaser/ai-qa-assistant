import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { STORAGE_KEYS } from "../src/features/chat/constants";
import {
  clearActiveChatId,
  createChat,
  GUEST_CHAT_STORAGE_SCOPE,
  getActiveChatId,
  getUserChatStorageScope,
  loadChats,
  mergeChatsByUpdatedAt,
  migrateGuestChatsToUser,
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

  it("preserves system error flags on stored messages", () => {
    const chat = createChat({
      id: "chat-error",
      messages: [
        {
          id: "message-error",
          role: "assistant",
          content: "Daily demo limit reached.",
          mode: "general",
          model: "gemini-2.5-flash",
          createdAt: "2026-05-20T00:00:00.000Z",
          isError: true,
        },
      ],
    });

    saveChats([chat]);

    assert.equal(loadChats()[0]?.messages[0]?.isError, true);
  });

  it("keeps guest and user chat storage isolated", () => {
    const guestChat = createChat({ id: "guest-chat", title: "Guest chat" });
    const userScope = getUserChatStorageScope("user-1");
    const userChat = createChat({ id: "user-chat", title: "User chat" });

    saveChats([guestChat], GUEST_CHAT_STORAGE_SCOPE);
    saveChats([userChat], userScope);
    setActiveChatId(guestChat.id, GUEST_CHAT_STORAGE_SCOPE);
    setActiveChatId(userChat.id, userScope);

    assert.equal(loadChats(GUEST_CHAT_STORAGE_SCOPE)[0]?.title, "Guest chat");
    assert.equal(loadChats(userScope)[0]?.title, "User chat");
    assert.equal(getActiveChatId(GUEST_CHAT_STORAGE_SCOPE), "guest-chat");
    assert.equal(getActiveChatId(userScope), "user-chat");
  });

  it("migrates guest chats into the signed-in user scope", () => {
    const guestChat = createChat({ id: "guest-chat", title: "Guest chat" });
    const existingUserChat = createChat({ id: "user-chat", title: "Existing user chat" });
    const userScope = getUserChatStorageScope("user-1");

    saveChats([guestChat], GUEST_CHAT_STORAGE_SCOPE);
    saveChats([existingUserChat], userScope);
    setActiveChatId(guestChat.id, GUEST_CHAT_STORAGE_SCOPE);

    assert.equal(migrateGuestChatsToUser("user-1"), true);
    assert.deepEqual(loadChats(GUEST_CHAT_STORAGE_SCOPE), []);
    assert.deepEqual(
      loadChats(userScope).map((chat) => chat.id),
      ["guest-chat", "user-chat"]
    );
    assert.equal(getActiveChatId(userScope), "guest-chat");
  });

  it("keeps the newest chat copy when merging local and account chats", () => {
    const oldChat = createChat({
      id: "chat-1",
      title: "Old title",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });
    const newChat = createChat({
      id: "chat-1",
      title: "New title",
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    const otherChat = createChat({
      id: "chat-2",
      title: "Other chat",
      updatedAt: "2026-05-18T00:00:00.000Z",
    });

    const mergedChats = mergeChatsByUpdatedAt([oldChat, otherChat, newChat]);

    assert.deepEqual(
      mergedChats.map((chat) => chat.title),
      ["New title", "Other chat"]
    );
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
