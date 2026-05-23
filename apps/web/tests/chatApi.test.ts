import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ChatApiError, sendMessageToAI } from "../src/features/chat/chatApi.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("chat api", () => {
  it("surfaces structured backend errors", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/chat");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");

      return jsonResponse(
        {
          code: "USAGE_LIMIT_REACHED",
          error: "Daily demo limit reached. Sign in for more messages or try again later.",
        },
        429
      );
    });

    await assert.rejects(
      () =>
        sendMessageToAI({
          history: [],
          message: "hello",
          mode: "general",
          model: "gemini-2.5-flash",
        }),
      (error) => {
        assert.ok(error instanceof ChatApiError);
        assert.equal(error.code, "USAGE_LIMIT_REACHED");
        assert.equal(error.status, 429);
        assert.match(error.message, /Daily demo limit reached/);
        return true;
      }
    );
  });
});

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = handler;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
