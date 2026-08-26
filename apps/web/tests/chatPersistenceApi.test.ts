import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import { deleteAccountChat, saveAccountChat } from "../src/features/chat/chatPersistenceApi";
import type { Chat } from "../src/features/chat/types";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("chat persistence api", () => {
  it("strips attachment previews before saving account chats", async () => {
    mockFetch(async (input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.equal(input, "/api/chats/chat-1");
      assert.equal(init?.method, "PUT");
      assert.equal(init?.credentials, "include");
      assert.equal(body.chat.projectId, "project-1");
      assert.deepEqual(body.chat.messages[0].attachments, [
        {
          assetId: "asset-1",
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
        },
      ]);

      return jsonResponse({
        chat: body.chat,
      });
    });

    await saveAccountChat(createChatWithPreview());
  });

  it("treats an already-absent chat as an idempotent delete", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/chats/already-deleted");
      assert.equal(init?.method, "DELETE");

      return jsonResponse({ code: "CHAT_NOT_FOUND" }, 404);
    });

    await deleteAccountChat("already-deleted");
  });
});

function createChatWithPreview(): Chat {
  return {
    id: "chat-1",
    projectId: "project-1",
    title: "Visual chat",
    mode: "general",
    model: "gemini-2.5-flash",
    createdAt: "2026-05-24T10:00:00.000Z",
    updatedAt: "2026-05-24T10:01:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Uploaded an image.",
        mode: "general",
        model: "gemini-2.5-flash",
        createdAt: "2026-05-24T10:01:00.000Z",
        attachments: [
          {
            assetId: "asset-1",
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            previewUrl: "data:image/png;base64,abc",
          },
        ],
      },
    ],
  };
}

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = createCsrfAwareFetch(handler);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
