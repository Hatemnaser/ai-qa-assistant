import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import { ChatApiError, sendMessageToAI } from "../src/features/chat/chatApi.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("chat api", () => {
  it("sends chat identity through the chat request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.equal(body.chatId, "chat-1");

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      chatId: "chat-1",
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("omits empty chat identity from the request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.equal("chatId" in body, false);

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      chatId: null,
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("sends attachments through the chat request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.deepEqual(body.attachments, [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          data: "abc",
        },
      ]);
      assert.equal("image" in body, false);

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      attachments: [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          data: "abc",
        },
      ],
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("sends text file attachment content through the chat request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.deepEqual(body.attachments, [
        {
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Checkout requirements",
        },
      ]);

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      attachments: [
        {
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Checkout requirements",
        },
      ],
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("sends authenticated attachments as opaque asset references", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.deepEqual(body.attachments, [{ assetId: "asset-1" }]);

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      attachments: [{ assetId: "asset-1" }],
      history: [],
      message: "review the attachment",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("sends project id through the chat request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.equal(body.projectId, "project-1");

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
      projectId: "project-1",
    });
  });

  it("omits empty project ids from the chat request contract", async () => {
    mockFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      assert.equal("projectId" in body, false);

      return jsonResponse({
        reply: "ok",
        mode: "general",
        model: "gemini-2.5-flash",
      });
    });

    await sendMessageToAI({
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
      projectId: null,
    });
  });

  it("surfaces structured backend errors", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/chat");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");

      return jsonResponse(
        {
          code: "USAGE_LIMIT_REACHED",
          error: "Daily demo credit limit reached. Sign in for more credits or try again later.",
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
        assert.match(error.message, /Daily demo credit limit reached/);
        return true;
      }
    );
  });
});

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
