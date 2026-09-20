import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ref } from "vue";

import {
  createChat,
  getUserChatStorageScope,
  loadChats,
  loadChatSyncState,
  saveChats,
} from "../src/features/chat/chatStorage";
import { DEFAULT_MODE, DEFAULT_MODEL } from "../src/features/chat/constants";
import { useStoredChats } from "../src/features/chat/composables/useStoredChats";
import type { SelectedAttachment } from "../src/features/chat/types";

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

  it("removes an existing chat from a project", () => {
    const { storedChats } = createStoredChatsHarness();
    const chat = createChat({ id: "chat-project", projectId: "project-1" });

    storedChats.addChatAndSelect(chat);
    storedChats.assignChatProject(chat.id, null);

    assert.equal(storedChats.activeChat.value?.projectId, null);
    assert.equal(loadChats().find((item) => item.id === chat.id)?.projectId, null);
  });

  it("isolates project drafts from existing chats and restores them without persisting a chat", () => {
    const { messageInput, selectedProjectId, storedChats } = createStoredChatsHarness();
    const existingChat = createChat({ id: "chat-active", projectId: null });

    storedChats.addChatAndSelect(existingChat);
    messageInput.value = "Draft project prompt";

    storedChats.prepareNewChatForProject(" project-3 ");
    assert.equal(messageInput.value, "");
    assert.equal(storedChats.chats.value.length, 1);
    messageInput.value = "A different project prompt";
    storedChats.selectChat(existingChat.id);
    assert.equal(messageInput.value, "Draft project prompt");
    storedChats.prepareNewChatForProject("project-3");
    const projectChat = storedChats.ensureActiveChat();

    assert.equal(projectChat.projectId, "project-3");
    assert.equal(selectedProjectId.value, "project-3");
    assert.equal(messageInput.value, "A different project prompt");
  });

  it("restores text, task, model, quick action and attachments independently per draft", () => {
    const h = createStoredChatsHarness();
    const attachment = { file: new File(["notes"], "notes.txt"), name: "notes.txt", mimeType: "text/plain", type: "file" } satisfies SelectedAttachment;
    h.messageInput.value = "Home draft";
    h.selectedMode.value = "edge_cases";
    h.selectedModel.value = "gemini-2.5-flash";
    h.quickActionMode.value = "edge_cases";
    h.selectedAttachments.value = [attachment];
    h.storedChats.prepareNewChatForProject("project-1");
    assert.equal(h.messageInput.value, "");
    assert.equal(h.selectedAttachments.value.length, 0);
    h.messageInput.value = "Project draft";
    h.storedChats.prepareNewChat();
    assert.equal(h.messageInput.value, "Home draft");
    assert.equal(h.selectedMode.value, "edge_cases");
    assert.equal(h.selectedModel.value, "gemini-2.5-flash");
    assert.equal(h.quickActionMode.value, "edge_cases");
    assert.equal(h.selectedAttachments.value[0]?.file, attachment.file);
    h.storedChats.startNewChat();
    assert.equal(h.messageInput.value, "Home draft");
    h.storedChats.prepareNewChatForProject("project-1");
    assert.equal(h.messageInput.value, "Project draft");
    assert.equal(h.storedChats.chats.value.length, 0);
  });

  it("keeps an unsaved project draft and mode when server chat reconciliation arrives", () => {
    const h = createStoredChatsHarness();
    h.storedChats.prepareNewChatForProject("project-1");
    h.messageInput.value = "Unsaved";
    h.selectedMode.value = "bug_report";
    h.storedChats.replaceChats([createChat({ id: "server-chat" })]);
    assert.equal(h.storedChats.activeChatId.value, null);
    assert.equal(h.selectedProjectId.value, "project-1");
    assert.equal(h.selectedMode.value, "bug_report");
    assert.equal(h.messageInput.value, "Unsaved");
  });

  it("uses the account default for a fresh home draft after the previous draft becomes a chat", () => {
    const h = createStoredChatsHarness();
    h.messageInput.value = "Existing draft";
    h.storedChats.drafts.setDefaultModel("gemini-2.5-flash-lite");
    const existing = h.storedChats.ensureActiveChat();
    assert.equal(existing.model, DEFAULT_MODEL);
    h.storedChats.prepareNewChat();
    assert.equal(h.selectedModel.value, "gemini-2.5-flash-lite");
    assert.equal(h.messageInput.value, "");
    h.storedChats.selectChat(existing.id);
    assert.equal(h.selectedModel.value, DEFAULT_MODEL);
    assert.equal(h.messageInput.value, "Existing draft");
  });

  it("invalidates pending submissions and releases drafts on account changes, not same-owner refresh", () => {
    const h = createStoredChatsHarness();
    h.storedChats.setChatStorageOwner("user-1");
    h.messageInput.value = "Private draft";
    const chat = h.storedChats.ensureActiveChat();
    const pending = h.storedChats.captureSubmission(chat.id);
    h.storedChats.setChatStorageOwner("user-1");
    assert.equal(h.messageInput.value, "Private draft");
    assert.equal(pending.getChat()?.id, chat.id);
    h.storedChats.setChatStorageOwner("user-2");
    assert.equal(h.messageInput.value, "");
    assert.equal(pending.getChat(), null);
    h.storedChats.setChatStorageOwner("user-1");
    assert.equal(h.messageInput.value, "");
    assert.equal(pending.getChat(), null);
  });

  it("marks only explicit signed-in edits and deletes for server reconciliation", () => {
    const { storedChats } = createStoredChatsHarness();
    const scope = getUserChatStorageScope("user-1");
    const staleCache = createChat({ id: "stale-cache" });

    saveChats([staleCache], scope);
    storedChats.setChatStorageOwner("user-1");
    const newChat = createChat({ id: "new-local" });
    storedChats.addChatAndSelect(newChat);

    assert.deepEqual(loadChatSyncState(scope), {
      pendingCreates: ["new-local"],
      pendingDeletes: [],
      pendingUpserts: [],
    });

    storedChats.deleteChat("new-local");

    assert.deepEqual(loadChatSyncState(scope), {
      pendingCreates: [],
      pendingDeletes: ["new-local"],
      pendingUpserts: [],
    });
    assert.equal(loadChatSyncState(scope).pendingUpserts.includes("stale-cache"), false);
  });

  it("discards unsaved create authority when leaving the signed-in scope", () => {
    const { storedChats } = createStoredChatsHarness();
    const scope = getUserChatStorageScope("user-1");
    storedChats.setChatStorageOwner("user-1");
    storedChats.addChatAndSelect(createChat({ id: "session-draft" }));

    assert.deepEqual(loadChatSyncState(scope).pendingCreates, ["session-draft"]);

    storedChats.setChatStorageOwner(null);

    assert.deepEqual(loadChatSyncState(scope).pendingCreates, []);
  });
});

function createStoredChatsHarness() {
  const messageInput = ref("");
  const selectedProjectId = ref<string | null>(null);
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const selectedAttachments = ref<SelectedAttachment[]>([]);
  const quickActionMode = ref<string | null>(null);
  const storedChats = useStoredChats({
    messageInput,
    quickActionMode,
    selectedAttachments,
    selectedMode,
    selectedModel,
    selectedProjectId,
  });

  return {
    messageInput,
    quickActionMode,
    selectedAttachments,
    selectedMode,
    selectedModel,
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
