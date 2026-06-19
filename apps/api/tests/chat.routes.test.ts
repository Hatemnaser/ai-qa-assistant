import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";

import { env } from "../src/config/env.ts";
import { createApp } from "../src/app.ts";
import {
  CHAT_RATE_LIMITED_MESSAGE,
  isChatRateLimited,
  resetChatRateLimitersForTests,
} from "../src/modules/chat/chat.rateLimit.ts";
import { GUEST_COOKIE_NAME } from "../src/modules/usage/usage.cookies.ts";

let server: Server;
let baseUrl: string;
let originalConsoleWarn: typeof console.warn;

before(async () => {
  originalConsoleWarn = console.warn;
  console.warn = () => {};

  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  console.warn = originalConsoleWarn;
});

afterEach(() => {
  resetChatRateLimitersForTests();
});

describe("POST /api/chat", () => {
  it("returns validation errors for invalid payloads", async () => {
    const response = await postJson("/api/chat", {});
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid request payload.");
    assert.ok(Array.isArray(body.issues));
  });

  it("returns a contract error for unsupported models", async () => {
    const response = await postJson("/api/chat", {
      message: "Generate test cases for login",
      mode: "test_cases",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
    assert.match(body.error, /Unsupported AI model/);
  });

  it("treats null image payloads as no image", async () => {
    const response = await postJson("/api/chat", {
      message: "Generate test cases for login",
      mode: "test_cases",
      model: "not-a-real-model",
      history: [],
      image: null,
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("accepts image attachments in the request contract", async () => {
    const response = await postJson("/api/chat", {
      attachments: [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          data: "abc",
        },
      ],
      message: "Review this visual",
      mode: "general",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("accepts text file attachments in the request contract", async () => {
    const response = await postJson("/api/chat", {
      attachments: [
        {
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Checkout requirements",
        },
      ],
      message: "Review this file",
      mode: "general",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("rejects unsupported file attachments in the request contract", async () => {
    const response = await postJson("/api/chat", {
      attachments: [
        {
          type: "file",
          name: "requirements.pdf",
          mimeType: "application/pdf",
          content: "fake pdf text",
        },
      ],
      message: "Review this file",
      mode: "general",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  it("accepts multiple chat attachments in the request contract", async () => {
    const response = await postJson("/api/chat", {
      attachments: [
        {
          type: "image",
          mimeType: "image/png",
          data: "abc",
        },
        {
          type: "image",
          mimeType: "image/png",
          data: "def",
        },
      ],
      message: "Review these",
      mode: "general",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("accepts an optional project id in the request contract", async () => {
    const response = await postJson("/api/chat", {
      message: "Generate test cases for login",
      mode: "test_cases",
      model: "not-a-real-model",
      history: [],
      projectId: " project-1 ",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("accepts an optional chat id in the request contract", async () => {
    const response = await postJson("/api/chat", {
      chatId: " chat-1 ",
      message: "Continue this conversation",
      mode: "general",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("rejects more than four chat attachments", async () => {
    const response = await postJson("/api/chat", {
      attachments: Array.from({ length: 5 }, (_, index) => ({
        type: "image",
        mimeType: "image/png",
        data: `image-${index}`,
      })),
      message: "Review these",
      mode: "general",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
  });

  it("rate limits chat attempts by IP even when the guest cookie changes", async () => {
    const response = await exhaustChatIpRateLimitWithRotatingGuestCookies();
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, CHAT_RATE_LIMITED_MESSAGE);
    assert.equal(body.message, CHAT_RATE_LIMITED_MESSAGE);
  });

  it("rate limits guest identity even when the IP changes", () => {
    let limited = false;

    for (let attempt = 0; attempt <= env.guestChatRateLimitMax; attempt += 1) {
      limited = isChatRateLimited({
        guestId: "guest-identity-limit-test",
        ipAddress: `203.0.113.${attempt}`,
      });
    }

    assert.equal(limited, true);
  });

  it("rate limits signed-in user identity even when the IP changes", () => {
    let limited = false;

    for (let attempt = 0; attempt <= env.chatRateLimitMax; attempt += 1) {
      limited = isChatRateLimited({
        ipAddress: `198.51.100.${attempt}`,
        userId: "user-identity-limit-test",
      });
    }

    assert.equal(limited, true);
  });
});

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}

async function exhaustChatIpRateLimitWithRotatingGuestCookies() {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= env.chatRateLimitMax; attempt += 1) {
    response = await postJson(
      "/api/chat",
      {
        history: [],
        message: "Generate test cases for login",
        mode: "test_cases",
        model: "not-a-real-model",
      },
      {
        cookie: `${GUEST_COOKIE_NAME}=${createGuestCookieValue(attempt)}`,
      }
    );
  }

  assert.ok(response);
  return response;
}

function createGuestCookieValue(attempt: number) {
  return `guestlimit${String(attempt).padStart(14, "0")}`;
}
