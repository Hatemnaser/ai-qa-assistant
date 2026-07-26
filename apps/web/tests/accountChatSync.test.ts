import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectLocalChatsToPersist } from "../src/features/chat/composables/useAccountChatSync.ts";
import type { Chat } from "../src/features/chat/types.ts";

describe("account chat sync", () => {
  it("persists only local-only or newer local chats after loading the server copy", () => {
    const localOnly = createChat("local-only", "2026-07-03T10:00:00.000Z");
    const localNewer = createChat("shared-newer", "2026-07-03T11:00:00.000Z");
    const localOlder = createChat("shared-older", "2026-07-03T09:00:00.000Z");
    const localEqual = createChat("shared-equal", "2026-07-03T10:00:00.000Z");

    const selected = selectLocalChatsToPersist(
      [localOnly, localNewer, localOlder, localEqual],
      [
        createChat("shared-newer", "2026-07-03T10:00:00.000Z"),
        createChat("shared-older", "2026-07-03T10:00:00.000Z"),
        createChat("shared-equal", "2026-07-03T10:00:00.000Z"),
      ]
    );

    assert.deepEqual(
      selected.map((chat) => chat.id),
      ["local-only", "shared-newer"]
    );
  });

  it("does not rewrite server-loaded imported chats during refresh", () => {
    const importedServerChat = createChat(
      "new-imported-chat",
      "2026-07-03T10:00:00.000Z"
    );

    assert.deepEqual(
      selectLocalChatsToPersist([], [importedServerChat]),
      []
    );
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
