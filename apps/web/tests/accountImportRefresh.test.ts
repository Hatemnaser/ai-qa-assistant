import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refreshAccountDataAfterImport } from "../src/features/data-portability/accountImportRefresh.ts";

describe("account import refresh", () => {
  it("refreshes Account Memory, projects, and chats without a browser reload", async () => {
    const events: string[] = [];

    await refreshAccountDataAfterImport({
      async refreshAccountMemory() {
        events.push("memory");
      },
      async refreshProjectsAndChats() {
        events.push("projects-and-chats");
      },
    });

    assert.deepEqual(events.sort(), ["memory", "projects-and-chats"]);
  });
});
