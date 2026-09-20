import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ref } from "vue";

import { AI_MODELS, DEFAULT_MODE, DEFAULT_MODEL } from "../src/features/chat/constants";
import { useChatSubmit, type ChatSubmitDependencies } from "../src/features/chat/composables/useChatSubmit";
import { useStoredChats } from "../src/features/chat/composables/useStoredChats";
import type { PreparedChatAttachments } from "../src/features/chat/chatAttachmentSubmission";
import type { ChatApiResponse, SelectedAttachment } from "../src/features/chat/types";

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  } });
});

describe("chat submission ownership", () => {
  it("clears only the origin draft after upload and retains edits made during upload", async () => {
    const upload = deferred<PreparedChatAttachments>();
    const h = harness({ prepareAttachments: () => upload.promise });
    h.messageInput.value = "Original";
    const pending = h.submit.handleSubmit();
    const originId = h.stored.activeChatId.value!;
    h.messageInput.value = "Edited while uploading";
    h.stored.prepareNewChatForProject("other-project");
    h.messageInput.value = "Other draft";
    h.selectedAttachments.value = [attachment("other.txt")];
    upload.resolve(noAttachments());
    await pending;
    assert.equal(h.messageInput.value, "Other draft");
    assert.equal(h.selectedAttachments.value[0]?.name, "other.txt");
    h.stored.selectChat(originId);
    assert.equal(h.messageInput.value, "Edited while uploading");
    assert.deepEqual(h.stored.activeMessages.value.map((m) => m.content), ["Original", "Reply"]);
  });

  it("consumes an unchanged origin draft even after navigating away", async () => {
    const upload = deferred<PreparedChatAttachments>();
    const h = harness({ prepareAttachments: () => upload.promise });
    h.messageInput.value = "Send this";
    h.selectedMode.value = "edge_cases";
    h.quickActionMode.value = "edge_cases";
    const pending = h.submit.handleSubmit();
    const originId = h.stored.activeChatId.value!;
    assert.equal(h.submit.sendingChatId.value, originId);
    h.stored.prepareNewChat();
    h.messageInput.value = "Home work";
    h.selectedMode.value = "bug_report";
    upload.resolve(noAttachments());
    await pending;
    assert.equal(h.messageInput.value, "Home work");
    assert.equal(h.selectedMode.value, "bug_report");
    h.stored.selectChat(originId);
    assert.equal(h.messageInput.value, "");
    assert.equal(h.selectedMode.value, DEFAULT_MODE);
    assert.equal(h.quickActionMode.value, null);
  });

  it("preserves origin rename and project moves before upload and AI completion", async () => {
    const upload = deferred<PreparedChatAttachments>();
    const ai = deferred<ChatApiResponse>();
    const h = harness({ prepareAttachments: () => upload.promise, sendMessage: () => ai.promise });
    h.stored.prepareNewChatForProject("initial-project");
    h.messageInput.value = "Analyze checkout";
    const pending = h.submit.handleSubmit();
    const originId = h.stored.activeChatId.value!;
    h.stored.renameChat(originId, "Name during upload");
    h.stored.assignChatProject(originId, "moved-first");
    upload.resolve(noAttachments());
    await Promise.resolve();
    await Promise.resolve();
    h.stored.renameChat(originId, "Final name");
    h.stored.assignChatProject(originId, "moved-again");
    ai.resolve(reply());
    await pending;
    assert.equal(h.stored.activeChat.value?.title, "Final name");
    assert.equal(h.stored.activeChat.value?.projectId, "moved-again");
    assert.equal(h.stored.activeMessages.value.length, 2);
  });

  it("never issues an AI request after an account switch during attachment preparation", async () => {
    const upload = deferred<PreparedChatAttachments>();
    let calls = 0;
    const h = harness({ prepareAttachments: () => upload.promise, sendMessage: async () => { calls += 1; return reply(); } });
    h.messageInput.value = "Secret";
    const pending = h.submit.handleSubmit();
    h.identity.value = "new-user";
    h.stored.setChatStorageOwner("new-user");
    h.messageInput.value = "New account";
    upload.resolve(noAttachments());
    await pending;
    assert.equal(calls, 0);
    assert.equal(h.stored.chats.value.length, 0);
    assert.equal(h.messageInput.value, "New account");
    assert.equal(h.submit.usageSummary.value, null);
  });

  it("ignores AI replies for deleted origin chats and account changes, including identity change before storage watcher", async () => {
    for (const boundary of ["delete", "identity", "owner"] as const) {
      const ai = deferred<ChatApiResponse>();
      const started = deferred<void>();
      const h = harness({ sendMessage: () => { started.resolve(); return ai.promise; } });
      h.messageInput.value = "Secret";
      const pending = h.submit.handleSubmit();
      await started.promise;
      if (boundary === "delete") h.stored.deleteChat(h.stored.activeChatId.value!);
      else if (boundary === "identity") h.identity.value = "user-2";
      else { h.identity.value = "user-2"; h.stored.setChatStorageOwner("user-2"); }
      ai.resolve({ ...reply(), usage: { remaining: 4, limit: 5, used: 1 } });
      await pending;
      assert.equal(h.stored.chats.value.some((chat) => chat.messages.some((m) => m.content === "Reply")), false);
      assert.equal(h.submit.usageSummary.value, null);
    }
  });

  it("records errors with the submitted mode and preserves the next draft", async () => {
    const ai = deferred<ChatApiResponse>();
    const started = deferred<void>();
    const h = harness({ sendMessage: () => { started.resolve(); return ai.promise; } });
    h.selectedMode.value = "edge_cases";
    h.messageInput.value = "Original";
    const pending = h.submit.handleSubmit();
    await started.promise;
    const originId = h.stored.activeChatId.value!;
    h.stored.prepareNewChatForProject("project-b");
    h.selectedMode.value = "bug_report";
    h.messageInput.value = "Still here";
    ai.reject(new Error("Request failed"));
    await pending;
    assert.equal(h.messageInput.value, "Still here");
    assert.equal(h.selectedMode.value, "bug_report");
    h.stored.selectChat(originId);
    assert.equal(h.stored.activeMessages.value.at(-1)?.mode, "edge_cases");
    assert.equal(h.stored.activeMessages.value.at(-1)?.isError, true);
  });

  it("retains upload-failure drafts and permits attachments-only submits without saving an empty chat", async () => {
    const h = harness({ prepareAttachments: async () => { throw new Error("Upload failed"); } });
    await h.submit.handleSubmit();
    assert.equal(h.stored.chats.value.length, 0);
    h.selectedAttachments.value = [attachment("evidence.txt")];
    await h.submit.handleSubmit();
    assert.equal(h.selectedAttachments.value.length, 1);
    assert.equal(h.stored.activeMessages.value.at(-1)?.content, "Upload failed");
  });
});

function harness(overrides: Partial<ChatSubmitDependencies> = {}) {
  const messageInput = ref("");
  const selectedMode = ref(DEFAULT_MODE);
  const selectedModel = ref(DEFAULT_MODEL);
  const selectedProjectId = ref<string | null>(null);
  const selectedAttachments = ref<SelectedAttachment[]>([]);
  const quickActionMode = ref<string | null>(null);
  const identity = ref<string | null>(null);
  const values = { messageInput, selectedMode, selectedModel, selectedProjectId, selectedAttachments, quickActionMode };
  const stored = useStoredChats(values);
  const submit = useChatSubmit({
    ...values,
    ensureActiveChat: stored.ensureActiveChat,
    captureSubmission: stored.captureSubmission,
    getAttachmentOnlyMessage: (attachments) => attachments.length ? "Uploaded attachment" : "",
    getIdentity: () => identity.value,
    isAuthenticated: () => Boolean(identity.value),
    modelOptions: ref([...AI_MODELS]),
    updateChat: stored.updateChat,
  }, {
    prepareAttachments: async () => noAttachments(),
    sendMessage: async () => reply(),
    ...overrides,
  });
  return { ...values, identity, stored, submit };
}

function noAttachments(): PreparedChatAttachments { return { displayAttachments: undefined, requestAttachments: null }; }
function reply(): ChatApiResponse { return { reply: "Reply", mode: DEFAULT_MODE, model: DEFAULT_MODEL }; }
function attachment(name: string): SelectedAttachment { return { file: new File(["notes"], name), name, type: "file", mimeType: "text/plain" }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
