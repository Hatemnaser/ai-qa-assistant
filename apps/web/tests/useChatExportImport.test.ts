import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ref } from "vue";

import { useChatExportImport } from "../src/features/chat/composables/useChatExportImport";
import type { Chat } from "../src/features/chat/types";

const originalAlert = globalThis.alert;
let alerts: string[];
beforeEach(() => {
  alerts = [];
  globalThis.alert = (message) => { alerts.push(String(message)); };
});
afterEach(() => { globalThis.alert = originalAlert; });

describe("account-scoped chat imports", () => {
  it("returns the imported chat only after a successful same-owner import", async () => {
    const h = harness();
    const event = fileEvent(async () => validChatJson());
    const imported = await h.importer.handleImportChat(event);
    assert.equal(imported?.messages[0]?.content, "Imported content");
    assert.equal(h.imported[0], imported);
    assert.equal((event.target as HTMLInputElement).value, "");
  });

  it("discards a file read after identity change instead of importing into the new account", async () => {
    const h = harness();
    const reading = deferred<string>();
    const pending = h.importer.handleImportChat(fileEvent(() => reading.promise));
    h.identity.value = "other-account";
    reading.resolve(validChatJson());
    assert.equal(await pending, null);
    assert.deepEqual(h.imported, []);
    assert.deepEqual(alerts, []);
  });

  it("does not show an old account's import error after identity change", async () => {
    const h = harness();
    const reading = deferred<string>();
    const pending = h.importer.handleImportChat(fileEvent(() => reading.promise));
    h.identity.value = "other-account";
    reading.reject(new Error("Read failed"));
    assert.equal(await pending, null);
    assert.deepEqual(alerts, []);
  });

  it("returns null and preserves selection for invalid imports", async () => {
    const h = harness();
    assert.equal(await h.importer.handleImportChat(fileEvent(async () => "not-json")), null);
    assert.equal(await h.importer.handleImportChat(fileEvent(async () => validChatJson(), "notes.txt")), null);
    assert.deepEqual(h.imported, []);
    assert.equal(alerts.length, 2);
  });
});

function harness() {
  const identity = ref("account-1");
  const imported: Chat[] = [];
  const importer = useChatExportImport({
    activeChat: ref(null),
    addChatAndSelect: (chat) => imported.push(chat),
    closeChatMenus: () => {},
    getIdentity: () => identity.value,
  });
  return { identity, imported, importer };
}
function fileEvent(text: () => Promise<string>, name = "chat.json") {
  return { target: { files: [{ name, text }], value: "local-file" } } as unknown as Event;
}
function validChatJson() { return JSON.stringify({ messages: [{ role: "user", content: "Imported content" }] }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
