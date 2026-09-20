import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { effectScope, ref } from "vue";

import { fileToSelectedAttachment } from "../src/features/chat/chatAttachments";
import { DEFAULT_MODE, DEFAULT_MODEL, QUICK_ACTIONS, VISUAL_REVIEW_MODEL } from "../src/features/chat/constants";
import { useChatAttachments, type ChatAttachmentDependencies } from "../src/features/chat/composables/useChatAttachments";
import { useChatController } from "../src/features/chat/composables/useChatController";
import { useStoredChats } from "../src/features/chat/composables/useStoredChats";
import type { SelectedAttachment } from "../src/features/chat/types";
import type { AuthUser } from "../src/features/auth/types";

const previousAlert = globalThis.alert;
let alerts: string[] = [];
beforeEach(() => {
  alerts = [];
  globalThis.alert = (message) => { alerts.push(String(message)); };
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  } });
});
afterEach(() => { globalThis.alert = previousAlert; });

describe("draft-scoped attachments", () => {
  it("finishes attachment selection in its original draft without changing the current draft", async () => {
    const conversion = deferred<SelectedAttachment>();
    const h = harness({ prepare: () => conversion.promise });
    const file = new File(["notes"], "notes.txt");
    const pending = h.attachments.handleAttachmentsSelected([file]);
    h.stored.prepareNewChatForProject("project-2");
    h.messageInput.value = "Project two";
    conversion.resolve(await fileToSelectedAttachment(file));
    await pending;
    assert.equal(h.selectedAttachments.value.length, 0);
    assert.equal(h.messageInput.value, "Project two");
    h.stored.prepareNewChat();
    assert.equal(h.selectedAttachments.value[0]?.name, "notes.txt");
  });

  it("does not exceed the attachment limit when two selection operations complete concurrently", async () => {
    const gate = deferred<void>();
    const h = harness({ prepare: async (file) => { await gate.promise; return fileToSelectedAttachment(file); } });
    const files = Array.from({ length: 3 }, (_, i) => new File(["data"], `file-${i}.txt`));
    const first = h.attachments.handleAttachmentsSelected(files);
    const second = h.attachments.handleAttachmentsSelected(files);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(h.selectedAttachments.value.length, 3);
    assert.equal(alerts.length, 1);
  });

  it("rejects unsupported files and oversized selections without mutating the draft", async () => {
    const h = harness();
    await h.attachments.handleAttachmentsSelected([new File(["pdf"], "report.pdf", { type: "application/pdf" })]);
    await h.attachments.handleAttachmentsSelected(Array.from({ length: 5 }, () => new File(["data"], "notes.txt")));
    assert.equal(h.selectedAttachments.value.length, 0);
    assert.equal(alerts.length, 2);
  });

  it("revokes all retained image URLs on account switch, not draft navigation", async () => {
    const revoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    try {
      const h = harness();
      await h.attachments.handleAttachmentsSelected([new File(["png"], "image.png", { type: "image/png" })]);
      const url = h.selectedAttachments.value[0]!.previewUrl!;
      h.stored.prepareNewChatForProject("project-2");
      assert.deepEqual(revoked, []);
      h.stored.setChatStorageOwner("other-account");
      assert.deepEqual(revoked, [url]);
      h.stored.prepareNewChat();
      assert.equal(h.selectedAttachments.value.length, 0);
    } finally { URL.revokeObjectURL = revoke; }
  });

  it("releases attachment conversions which finish after account change or draft deletion", async () => {
    for (const boundary of ["owner", "deleted"] as const) {
      const conversion = deferred<SelectedAttachment>();
      const h = harness({ prepare: () => conversion.promise });
      const chat = h.stored.ensureActiveChat();
      const file = new File(["png"], "image.png", { type: "image/png" });
      const pending = h.attachments.handleAttachmentsSelected([file]);
      if (boundary === "owner") h.stored.setChatStorageOwner("other-account");
      else h.stored.deleteChat(chat.id);
      conversion.resolve(await fileToSelectedAttachment(file));
      await pending;
      assert.equal(h.selectedAttachments.value.length, 0);
    }
  });
});

describe("chat controller drafts", () => {
  it("seeds only future drafts from the account model default and preserves existing drafts", () => {
    const scope = effectScope();
    const controller = scope.run(() => useChatController(ref<AuthUser | null>(null)))!;
    controller.messageInput.value = "Existing home draft";
    controller.setDefaultModel("gemini-2.5-flash-lite");
    assert.equal(controller.selectedModel.value, DEFAULT_MODEL);
    controller.prepareNewChatForProject("project-one");
    assert.equal(controller.selectedModel.value, "gemini-2.5-flash-lite");
    controller.messageInput.value = "Existing project draft";
    controller.setDefaultModel("gemini-2.5-flash");
    assert.equal(controller.selectedModel.value, "gemini-2.5-flash-lite");
    controller.prepareNewChatForProject("project-two");
    assert.equal(controller.selectedModel.value, "gemini-2.5-flash");
    controller.prepareNewChatForProject("project-one");
    assert.equal(controller.selectedModel.value, "gemini-2.5-flash-lite");
    assert.equal(controller.messageInput.value, "Existing project draft");
    controller.prepareNewChat();
    assert.equal(controller.selectedModel.value, DEFAULT_MODEL);
    assert.equal(controller.messageInput.value, "Existing home draft");
    controller.prepareNewChatForProject("project-two");
    controller.applyQuickAction(QUICK_ACTIONS[4]);
    assert.equal(controller.selectedModel.value, VISUAL_REVIEW_MODEL);
    scope.stop();
  });

  it("normalizes new default models and clears the future-draft seed on identity changes", () => {
    const scope = effectScope();
    const user = ref<AuthUser | null>(null);
    const controller = scope.run(() => useChatController(user))!;
    controller.setDefaultModel("unknown-model");
    controller.prepareNewChatForProject("normalized");
    assert.equal(controller.selectedModel.value, DEFAULT_MODEL);
    controller.setDefaultModel("gemini-2.5-flash-lite");
    user.value = { id: "u1", createdAt: "", email: "test@example.test", emailVerifiedAt: null, locale: "en", name: null };
    controller.prepareNewChatForProject("after-identity-change");
    assert.equal(controller.selectedModel.value, DEFAULT_MODEL);
    controller.setChatStorageOwner("u1");
    controller.setDefaultModel("gemini-2.5-flash-lite");
    controller.prepareNewChatForProject("signed-in-draft");
    assert.equal(controller.selectedModel.value, "gemini-2.5-flash-lite");
    controller.setChatStorageOwner(null);
    controller.prepareNewChatForProject("after-owner-change");
    assert.equal(controller.selectedModel.value, DEFAULT_MODEL);
    scope.stop();
  });

  it("does not overwrite typed prompts with quick actions, and retains visual-model compatibility", () => {
    const scope = effectScope();
    const controller = scope.run(() => useChatController(ref<AuthUser | null>(null)))!;
    controller.messageInput.value = "My actual checkout problem";
    controller.applyQuickAction(QUICK_ACTIONS[4]);
    assert.equal(controller.messageInput.value, "My actual checkout problem");
    assert.equal(controller.selectedMode.value, "screenshot_review");
    assert.equal(controller.selectedModel.value, VISUAL_REVIEW_MODEL);
    controller.prepareNewChatForProject("p1");
    assert.equal(controller.messageInput.value, "");
    controller.applyQuickAction(QUICK_ACTIONS[0]);
    assert.notEqual(controller.messageInput.value, "");
    controller.prepareNewChat();
    assert.equal(controller.messageInput.value, "My actual checkout problem");
    assert.equal(controller.selectedModel.value, VISUAL_REVIEW_MODEL);
    scope.stop();
  });

  it("invalidates attachment work immediately on identity change, including switching away and back", async () => {
    const scope = effectScope();
    const currentUser = ref<AuthUser | null>(null);
    const controller = scope.run(() => useChatController(currentUser))!;
    const pending = controller.handleAttachmentsSelected([new File(["png"], "image.png", { type: "image/png" })]);
    currentUser.value = { id: "u1", createdAt: "", email: "test@example.test", emailVerifiedAt: null, locale: "en", name: null };
    currentUser.value = null;
    await pending;
    assert.equal(controller.selectedAttachments.value.length, 0);
    scope.stop();
  });

  it("releases inactive draft image URLs when the controller unmounts", async () => {
    const revoke = URL.revokeObjectURL;
    const revoked: string[] = [];
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
    try {
      const scope = effectScope();
      const controller = scope.run(() => useChatController(ref<AuthUser | null>(null)))!;
      await controller.handleAttachmentsSelected([new File(["png"], "image.png", { type: "image/png" })]);
      controller.prepareNewChatForProject("p1");
      scope.stop();
      assert.equal(revoked.length, 1);
    } finally { URL.revokeObjectURL = revoke; }
  });
});

function harness(dependencies: ChatAttachmentDependencies = { prepare: fileToSelectedAttachment }) {
  const values = {
    messageInput: ref(""),
    selectedMode: ref(DEFAULT_MODE),
    selectedModel: ref(DEFAULT_MODEL),
    selectedProjectId: ref<string | null>(null),
    selectedAttachments: ref<SelectedAttachment[]>([]),
    quickActionMode: ref<string | null>(null),
  };
  const stored = useStoredChats(values);
  const attachments = useChatAttachments({ selectedAttachments: values.selectedAttachments, drafts: stored.drafts }, dependencies);
  return { ...values, stored, attachments };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
