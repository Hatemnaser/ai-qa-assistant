import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getCurrentUser, login } from "../src/features/auth/authApi.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("auth api", () => {
  it("sends login requests with credentials included", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/auth/login");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        email: "person@example.com",
        password: "Password1",
        remember: true,
      });

      return jsonResponse({
        session: {
          expiresAt: "2026-05-26T00:00:00.000Z",
        },
        user: {
          createdAt: "2026-05-19T00:00:00.000Z",
          email: "person@example.com",
          id: "user-1",
          locale: "en",
          name: "Person",
        },
      });
    });

    const response = await login({
      email: "person@example.com",
      password: "Password1",
      remember: true,
    });

    assert.equal(response.user.email, "person@example.com");
    assert.equal(response.session.expiresAt, "2026-05-26T00:00:00.000Z");
  });

  it("returns null when there is no current session", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/auth/me");
      assert.equal(init?.credentials, "include");
      return jsonResponse({ error: "Authentication is required.", code: "SESSION_REQUIRED" }, 401);
    });

    const response = await getCurrentUser();

    assert.equal(response, null);
  });

  it("uses backend auth errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ error: "Invalid email or password." }, 401));

    await assert.rejects(
      () =>
        login({
          email: "person@example.com",
          password: "wrong-password",
          remember: false,
        }),
      /Invalid email or password/
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
