import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";
import { env } from "../src/config/env.ts";
import { getCsrfHeaders } from "./helpers/csrf.ts";

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

describe("CSRF protection", () => {
  it("issues a signed CSRF token and readable CSRF cookie", async () => {
    const response = await fetch(`${baseUrl}/api/auth/csrf`);
    const body = (await response.json()) as { csrfToken?: string };
    const setCookie = response.headers.get("set-cookie") || "";

    assert.equal(response.status, 200);
    assert.ok(body.csrfToken);
    assert.match(setCookie, new RegExp(`${env.csrfCookieName}=`));
    assert.doesNotMatch(setCookie, /HttpOnly/i);
    assert.doesNotMatch(body.csrfToken, /session/i);
  });

  it("rejects POST /api/chat without a CSRF token", async () => {
    const response = await postJson("/api/chat", chatBody());
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "CSRF_TOKEN_INVALID");
  });

  it("allows POST /api/chat with a valid CSRF token", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await postJson("/api/chat", chatBody(), csrfHeaders);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
  });

  it("rejects missing CSRF cookie, missing CSRF header, and invalid tokens", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);

    const missingCookie = await postJson("/api/chat", chatBody(), {
      "x-csrf-token": csrfHeaders["x-csrf-token"],
    });
    const missingHeader = await postJson("/api/chat", chatBody(), {
      cookie: csrfHeaders.cookie,
    });
    const invalidToken = await postJson("/api/chat", chatBody(), {
      cookie: `${env.csrfCookieName}=invalid.invalid`,
      "x-csrf-token": "invalid.invalid",
    });

    assert.equal(missingCookie.status, 403);
    assert.equal((await missingCookie.json()).code, "CSRF_TOKEN_INVALID");
    assert.equal(missingHeader.status, 403);
    assert.equal((await missingHeader.json()).code, "CSRF_TOKEN_INVALID");
    assert.equal(invalidToken.status, 403);
    assert.equal((await invalidToken.json()).code, "CSRF_TOKEN_INVALID");
  });

  it("protects auth state-changing routes", async () => {
    const routes = [
      ["/api/auth/logout", {}],
      ["/api/auth/login", { email: "person@example.com", password: "Password1" }],
      ["/api/auth/register", { email: "person@example.com", password: "Password1" }],
      ["/api/auth/forgot-password", { email: "person@example.com" }],
      ["/api/auth/reset-password", { token: "reset-token-value", newPassword: "Password1" }],
      ["/api/auth/verify-email", { token: "verification-token-value" }],
      ["/api/auth/resend-verification", { email: "person@example.com" }],
    ] as const;

    for (const [path, body] of routes) {
      const response = await postJson(path, body);
      const payload = await response.json();

      assert.equal(response.status, 403, path);
      assert.equal(payload.code, "CSRF_TOKEN_INVALID", path);
    }
  });

  it("protects chat-history, project, memory, and settings mutations", async () => {
    const requests = [
      fetch(`${baseUrl}/api/chats/chat-1`, { method: "DELETE" }),
      fetch(`${baseUrl}/api/chats/chat-1`, {
        body: JSON.stringify({ chat: {} }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      postJson("/api/projects", { name: "Project" }),
      fetch(`${baseUrl}/api/projects/project-1`, { method: "DELETE" }),
      postJson("/api/projects/project-1/documents", { title: "Doc", content: "Body" }),
      postJson("/api/memories", { content: "Memory" }),
      fetch(`${baseUrl}/api/settings`, {
        body: JSON.stringify({ language: "en", theme: "light" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ];

    for (const response of await Promise.all(requests)) {
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.code, "CSRF_TOKEN_INVALID");
    }
  });

  it("does not require CSRF tokens for GET routes", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("does not break CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      headers: {
        "access-control-request-headers": "content-type,x-csrf-token",
        "access-control-request-method": "POST",
        origin: "http://localhost:5173",
      },
      method: "OPTIONS",
    });

    assert.notEqual(response.status, 403);
    assert.equal(response.status, 204);
  });

  it("rejects state-changing requests from unknown origins", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await postJson("/api/chat", chatBody(), {
      ...csrfHeaders,
      origin: "https://evil.example",
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "CORS_FORBIDDEN");
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

function chatBody() {
  return {
    history: [],
    message: "Generate test cases for login",
    mode: "test_cases",
    model: "not-a-real-model",
  };
}
