import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("account deletion UX contract", () => {
  it("requires a deliberate second step and current-password confirmation", async () => {
    const source = await readSource("src/features/account/components/AccountDeletionPanel.vue");

    assert.match(source, /v-if="!isConfirming"/);
    assert.match(source, /autocomplete="current-password"/);
    assert.match(source, /required/);
    assert.match(source, /await deleteCurrentAccount\(currentPassword\.value\)/);
    assert.match(source, /role="alert"/);
    assert.doesNotMatch(source, /window\.confirm/);
  });

  it("clears the deleted user's local chats and in-memory session before returning to guest chat", async () => {
    const source = await readSource("src/App.vue");
    const handler = source.match(/function handleAccountDeleted[\s\S]*?\n}/)?.[0] || "";

    assert.match(handler, /clearScheduledChatPersist\(\)/);
    assert.match(handler, /clearChats\(getUserChatStorageScope\(userId\)\)/);
    assert.match(handler, /clearCurrentUser\(\)/);
    assert.match(handler, /setChatStorageOwner\(null\)/);
    assert.match(handler, /navigateToChat\(\)/);
    assert.match(source, /@account-deleted="handleAccountDeleted"/);
  });
});

function readSource(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
