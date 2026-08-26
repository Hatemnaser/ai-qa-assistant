import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { STORAGE_KEYS } from "../src/features/chat/constants";
import {
  clearActiveChatId,
  clearChats,
  createChat,
  discardVolatileChatCreates,
  GUEST_CHAT_STORAGE_SCOPE,
  getActiveChatId,
  getUserChatStorageScope,
  loadChats,
  loadChatSyncState,
  markChatPendingDelete,
  markChatPendingUpsert,
  mergeChatsByUpdatedAt,
  migrateGuestChatsToUser,
  saveChats,
  setActiveChatId,
} from "../src/features/chat/chatStorage";

beforeEach(() => {
  installMemoryStorage();
  discardVolatileChatCreates(getUserChatStorageScope("user-1"));
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
              attachment: {
                type: "image",
                name: "legacy.png",
                mimeType: "image/png",
                previewUrl: "data:image/png;base64,abc",
              },
            },
            {
              content: "multiple",
              role: "user",
              attachments: [
                {
                  type: "file",
                  name: "requirements.md",
                  mimeType: "text/markdown",
                },
                {
                  type: "image",
                  name: "screen.webp",
                  mimeType: "image/webp",
                },
              ],
            },
          ],
        },
      ])
    );

    const [chat] = loadChats();

    assert.equal(chat?.id, "chat-1");
    assert.equal(chat?.projectId, null);
    assert.equal(chat?.title, "Legacy chat");
    assert.equal(chat?.messages[0]?.role, "assistant");
    assert.equal(chat?.messages[0]?.content, "hello");
    assert.equal(chat?.messages[0]?.mode, "edge_cases");
    assert.equal(chat?.messages[0]?.model, "gemini-2.5-flash-lite");
    assert.equal(chat?.messages[0]?.attachments?.[0]?.name, "legacy.png");
    assert.equal(chat?.messages[0]?.attachments?.[0]?.previewUrl, undefined);
    assert.equal(chat?.messages[1]?.attachments?.length, 2);
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
      projectId: " project-1 ",
      title: "Saved chat",
    });

    saveChats([chat]);
    setActiveChatId(chat.id);

    assert.equal(loadChats()[0]?.title, "Saved chat");
    assert.equal(loadChats()[0]?.projectId, "project-1");
    assert.equal(getActiveChatId(), "chat-2");

    clearActiveChatId();

    assert.equal(getActiveChatId(), null);
  });

  it("never persists attachment previews or base64 image data in localStorage", () => {
    const chat = createChat({
      id: "chat-with-image",
      messages: [
        {
          id: "message-with-image",
          role: "user",
          content: "Review this screenshot",
          mode: "visual_review",
          model: "gemini-2.5-flash",
          createdAt: "2026-08-12T00:00:00.000Z",
          attachments: [
            {
              assetId: "asset-private-1",
              type: "image",
              name: "screen.png",
              mimeType: "image/png",
              previewUrl: "data:image/png;base64,private-image-bytes",
            },
          ],
        },
      ],
    });

    assert.equal(saveChats([chat]), true);
    const persisted = localStorage.getItem(STORAGE_KEYS.CHATS) ?? "";

    assert.doesNotMatch(persisted, /previewUrl|private-image-bytes|data:image/i);
    assert.match(persisted, /asset-private-1/);
    assert.equal(loadChats()[0]?.messages[0]?.attachments?.[0]?.assetId, "asset-private-1");
    assert.equal(loadChats()[0]?.messages[0]?.attachments?.[0]?.name, "screen.png");
    assert.equal(loadChats()[0]?.messages[0]?.attachments?.[0]?.previewUrl, undefined);
  });

  it("keeps the in-memory chat usable when browser storage rejects a write", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        ...localStorage,
        setItem: () => {
          throw new Error("quota exceeded");
        },
      } as Storage,
    });

    assert.equal(saveChats([createChat({ id: "chat-quota" })]), false);
  });

  it("preserves system error flags on stored messages", () => {
    const chat = createChat({
      id: "chat-error",
      messages: [
        {
          id: "message-error",
          role: "assistant",
          content: "Daily demo credit limit reached.",
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

  it("clears only the deleted user's scoped local chats", () => {
    const deletedUserScope = getUserChatStorageScope("deleted-user");
    const otherUserScope = getUserChatStorageScope("other-user");

    saveChats([createChat({ id: "deleted-chat" })], deletedUserScope);
    saveChats([createChat({ id: "other-chat" })], otherUserScope);
    setActiveChatId("deleted-chat", deletedUserScope);

    clearChats(deletedUserScope);

    assert.deepEqual(loadChats(deletedUserScope), []);
    assert.equal(getActiveChatId(deletedUserScope), null);
    assert.equal(loadChats(otherUserScope)[0]?.id, "other-chat");
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
    assert.deepEqual(loadChatSyncState(userScope), {
      pendingCreates: ["guest-chat"],
      pendingDeletes: [],
      pendingUpserts: [],
    });
    assert.equal(
      localStorage.getItem(`${STORAGE_KEYS.CHAT_SYNC_STATE}:${userScope}`),
      null
    );
  });

  it("keeps explicit user mutations and deletion tombstones durable", () => {
    const userScope = getUserChatStorageScope("user-1");

    markChatPendingUpsert("chat-1", userScope);
    markChatPendingUpsert("chat-2", userScope);
    markChatPendingDelete("chat-1", userScope);

    assert.deepEqual(loadChatSyncState(userScope), {
      pendingCreates: [],
      pendingDeletes: ["chat-1"],
      pendingUpserts: ["chat-2"],
    });

    installStorageFromCurrentContents();

    assert.deepEqual(loadChatSyncState(userScope), {
      pendingCreates: [],
      pendingDeletes: ["chat-1"],
      pendingUpserts: ["chat-2"],
    });
  });

  it("does not mark a colliding guest id as an account overwrite", () => {
    const userScope = getUserChatStorageScope("collision-user");
    saveChats([createChat({ id: "same-id", title: "Guest copy" })], GUEST_CHAT_STORAGE_SCOPE);
    saveChats([createChat({ id: "same-id", title: "Account copy" })], userScope);

    migrateGuestChatsToUser("collision-user");

    assert.equal(loadChats(userScope)[0]?.title, "Account copy");
    assert.deepEqual(loadChatSyncState(userScope).pendingUpserts, []);
  });

  it("does not create sync mutations for guest chats", () => {
    markChatPendingUpsert("guest-chat", GUEST_CHAT_STORAGE_SCOPE);
    markChatPendingDelete("guest-chat", GUEST_CHAT_STORAGE_SCOPE);

    assert.deepEqual(loadChatSyncState(GUEST_CHAT_STORAGE_SCOPE), {
      pendingCreates: [],
      pendingDeletes: [],
      pendingUpserts: [],
    });
  });

  it("keeps pending account mutations in memory when localStorage rejects them", () => {
    const scope = getUserChatStorageScope("storage-blocked-user");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        ...localStorage,
        getItem: () => null,
        removeItem: () => {},
        setItem: () => { throw new Error("storage blocked"); },
      } as Storage,
    });

    markChatPendingUpsert("in-memory-draft", scope);

    assert.deepEqual(loadChatSyncState(scope).pendingUpserts, ["in-memory-draft"]);
  });

  it("uses safe fallbacks and still clears account cache when localStorage is unavailable", () => {
    const scope = getUserChatStorageScope("security-error-user");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });

    assert.deepEqual(loadChats(scope), []);
    assert.equal(getActiveChatId(scope), null);
    assert.equal(setActiveChatId("chat-1", scope), false);

    markChatPendingUpsert("in-memory-draft", scope);
    assert.deepEqual(loadChatSyncState(scope).pendingUpserts, ["in-memory-draft"]);

    assert.doesNotThrow(() => clearChats(scope));
    assert.deepEqual(loadChatSyncState(scope), {
      pendingCreates: [],
      pendingDeletes: [],
      pendingUpserts: [],
    });
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

function installStorageFromCurrentContents() {
  const entries = Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index);

    return key ? [key, localStorage.getItem(key) || ""] as const : null;
  }).filter((entry): entry is readonly [string, string] => Boolean(entry));

  installMemoryStorage();
  for (const [key, value] of entries) localStorage.setItem(key, value);
}
