import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ref } from "vue";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import type { AuthUser } from "../src/features/auth/types.ts";
import {
  selectLocalChatsToPersist,
  useAccountChatSync,
} from "../src/features/chat/composables/useAccountChatSync.ts";
import {
  discardVolatileChatCreates,
  getUserChatStorageScope,
  loadChatSyncState,
  markChatPendingCreate,
  markChatPendingDelete,
  markChatPendingUpsert,
} from "../src/features/chat/chatStorage.ts";
import type { Chat } from "../src/features/chat/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

beforeEach(() => {
  installMemoryStorage();
  discardVolatileChatCreates(getUserChatStorageScope("user-1"));
  discardVolatileChatCreates(getUserChatStorageScope("user-2"));
  resetCsrfTokenForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  resetCsrfTokenForTests();
});

describe("account chat sync", () => {
  it("reconciles only explicit pending local mutations", () => {
    const localOnly = createChat("local-only", "2026-07-03T10:00:00.000Z");
    const staleLocalOnly = createChat("stale-local-cache", "2026-07-03T12:00:00.000Z");
    const localNewer = createChat("shared-newer", "2026-07-03T11:00:00.000Z");
    const localOlder = createChat("shared-older", "2026-07-03T09:00:00.000Z");
    const localEqual = createChat("shared-equal", "2026-07-03T10:00:00.000Z");

    const selected = selectLocalChatsToPersist(
      [localOnly, staleLocalOnly, localNewer, localOlder, localEqual],
      ["local-only", "shared-newer", "shared-older", "shared-equal"]
    );

    assert.deepEqual(
      selected.map((chat) => chat.id),
      ["local-only", "shared-newer", "shared-older", "shared-equal"]
    );
  });

  it("treats a missing server chat as deleted unless the local copy is explicitly pending", () => {
    const staleLocalCache = createChat("deleted-on-another-device", "2026-07-03T12:00:00.000Z");

    assert.deepEqual(selectLocalChatsToPersist([staleLocalCache], []), []);
    assert.deepEqual(
      selectLocalChatsToPersist([staleLocalCache], [staleLocalCache.id]).map((chat) => chat.id),
      [staleLocalCache.id]
    );
  });

  it("does not rewrite server-loaded imported chats during refresh", () => {
    assert.deepEqual(
      selectLocalChatsToPersist([], []),
      []
    );
  });

  it("drops a stale user cache entry when the server no longer has it", async () => {
    const stale = createChat("deleted-remotely", "2026-07-03T12:00:00.000Z");
    const serverChat = createChat("server-chat", "2026-07-03T10:00:00.000Z");
    const chats = ref([stale]);
    let putCalls = 0;

    globalThis.fetch = createCsrfAwareFetch(async (_input, init) => {
      if (init?.method === "PUT") putCalls += 1;

      return jsonResponse({ chats: [serverChat] });
    });
    const sync = useAccountChatSync({
      chats,
      currentUser: ref<AuthUser | null>(authUser()),
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    await sync.syncAccountChats();
    sync.clearScheduledChatPersist();

    assert.deepEqual(chats.value.map((chat) => chat.id), ["server-chat"]);
    assert.equal(putCalls, 0);
  });

  it("keeps a failed delete tombstone and hides the stale server copy", async () => {
    const stale = createChat("pending-delete", "2026-07-03T12:00:00.000Z");
    const chats = ref<Chat[]>([]);
    const scope = getUserChatStorageScope("user-1");
    markChatPendingDelete(stale.id, scope);
    console.warn = () => {};

    globalThis.fetch = createCsrfAwareFetch(async (_input, init) => {
      if (init?.method === "DELETE") return jsonResponse({ error: "offline" }, 503);

      return jsonResponse({ chats: [stale] });
    });
    const sync = useAccountChatSync({
      chats,
      currentUser: ref<AuthUser | null>(authUser()),
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    await sync.syncAccountChats();
    sync.clearScheduledChatPersist();

    assert.deepEqual(chats.value, []);
    assert.deepEqual(loadChatSyncState(scope).pendingDeletes, [stale.id]);
  });

  it("lets a newer server copy supersede and clear an older pending edit", async () => {
    const local = createChat("shared", "2026-07-03T10:00:00.000Z");
    const server = createChat("shared", "2026-07-03T11:00:00.000Z");
    const chats = ref([local]);
    const scope = getUserChatStorageScope("user-1");
    markChatPendingUpsert(local.id, scope);

    globalThis.fetch = createCsrfAwareFetch(async () => jsonResponse({ chats: [server] }));
    const sync = useAccountChatSync({
      chats,
      currentUser: ref<AuthUser | null>(authUser()),
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    await sync.syncAccountChats();
    sync.clearScheduledChatPersist();

    assert.equal(chats.value[0]?.updatedAt, server.updatedAt);
    assert.deepEqual(loadChatSyncState(scope).pendingUpserts, []);
  });

  it("lets a remote delete win over a pending update", async () => {
    const local = createChat("deleted-while-offline", "2026-07-03T12:00:00.000Z");
    const chats = ref([local]);
    const scope = getUserChatStorageScope("user-1");
    let putCalls = 0;
    markChatPendingUpsert(local.id, scope);

    globalThis.fetch = createCsrfAwareFetch(async (_input, init) => {
      if (init?.method === "PUT") putCalls += 1;

      return jsonResponse({ chats: [] });
    });
    const sync = useAccountChatSync({
      chats,
      currentUser: ref<AuthUser | null>(authUser()),
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    await sync.syncAccountChats();
    sync.clearScheduledChatPersist();

    assert.deepEqual(chats.value, []);
    assert.deepEqual(loadChatSyncState(scope).pendingUpserts, []);
    assert.equal(putCalls, 0);
  });

  it("uploads a new draft only while it is an explicit current-session create", async () => {
    const draft = createChat("new-draft", "2026-07-03T12:00:00.000Z");
    const chats = ref([draft]);
    const scope = getUserChatStorageScope("user-1");
    let putCalls = 0;
    markChatPendingCreate(draft.id, scope);

    globalThis.fetch = createCsrfAwareFetch(async (_input, init) => {
      if (init?.method === "PUT") {
        putCalls += 1;
        return jsonResponse({ chat: draft });
      }

      return jsonResponse({ chats: [] });
    });
    const sync = useAccountChatSync({
      chats,
      currentUser: ref<AuthUser | null>(authUser()),
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    await sync.syncAccountChats();
    sync.clearScheduledChatPersist();

    assert.deepEqual(chats.value.map((chat) => chat.id), [draft.id]);
    assert.deepEqual(loadChatSyncState(scope).pendingCreates, []);
    assert.equal(putCalls, 1);
  });

  it("queues a fresh sync when the signed-in user changes mid-request", async () => {
    const chats = ref<Chat[]>([]);
    const currentUser = ref<AuthUser | null>(authUser("user-1"));
    let releaseFirstFetch: (() => void) | undefined;
    const firstFetch = new Promise<void>((resolve) => { releaseFirstFetch = resolve; });
    let fetchCount = 0;

    globalThis.fetch = createCsrfAwareFetch(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        await firstFetch;
        return jsonResponse({ chats: [createChat("user-1-chat", "2026-07-03T10:00:00.000Z")] });
      }

      return jsonResponse({ chats: [createChat("user-2-chat", "2026-07-03T11:00:00.000Z")] });
    });
    const sync = useAccountChatSync({
      chats,
      currentUser,
      replaceChats: (nextChats) => { chats.value = nextChats; },
    });

    const firstSync = sync.syncAccountChats();
    currentUser.value = authUser("user-2");
    const secondSync = sync.syncAccountChats();
    releaseFirstFetch?.();
    await Promise.all([firstSync, secondSync]);
    sync.clearScheduledChatPersist();

    assert.equal(fetchCount, 2);
    assert.deepEqual(chats.value.map((chat) => chat.id), ["user-2-chat"]);
  });
});

function createChat(id: string, updatedAt: string): Chat {
  return {
    id,
    projectId: null,
    title: id,
    mode: "general",
    model: "gemini-3.1-flash-lite",
    messages: [],
    createdAt: "2026-07-03T08:00:00.000Z",
    updatedAt,
  };
}

function authUser(id = "user-1"): AuthUser {
  return {
    createdAt: "2026-07-01T00:00:00.000Z",
    email: "user@example.com",
    emailVerifiedAt: "2026-07-01T00:01:00.000Z",
    id,
    locale: "en",
    name: "User",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function installMemoryStorage() {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => { store.set(key, String(value)); },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });
}
