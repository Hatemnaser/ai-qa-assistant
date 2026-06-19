import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";

import { env } from "../src/config/env.ts";
import { createApp } from "../src/app.ts";
import { resetAuthRateLimitersForTests } from "../src/modules/auth/auth.rateLimit.ts";

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
  resetAuthRateLimitersForTests();
});

describe("POST /api/auth", () => {
  it("returns validation errors for invalid register payloads", async () => {
    const response = await postJson("/api/auth/register", {
      email: "not-an-email",
      password: "short",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid request payload.");
    assert.ok(Array.isArray(body.issues));
  });

  it("returns validation errors for invalid login payloads", async () => {
    const response = await postJson("/api/auth/login", {
      email: "person@example.com",
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid request payload.");
    assert.ok(Array.isArray(body.issues));
  });

  it("requires a session cookie for the current user route", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("clears the auth cookie on logout", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
    });
    const body = await response.json();
    const setCookie = response.headers.get("set-cookie") || "";

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
    });
    assert.match(setCookie, /qa_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
  });

  it("rate limits login attempts", async () => {
    const response = await exhaustRateLimit("/api/auth/login", env.authLoginRateLimitMax, {
      email: "limited-login@example.com",
    });
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, "Too many attempts. Please try again later.");
    assert.equal(body.message, "Too many attempts. Please try again later.");
  });

  it("rate limits login attempts even when the submitted email changes", async () => {
    const response = await exhaustRateLimitWithBodyFactory(
      "/api/auth/login",
      env.authLoginRateLimitMax,
      (attempt) => ({
        email: `rotated-login-${attempt}@example.com`,
      })
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("rate limits register attempts", async () => {
    const response = await exhaustRateLimit("/api/auth/register", env.authRegisterRateLimitMax, {
      email: "limited-register@example.com",
      password: "short",
    });
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, "Too many attempts. Please try again later.");
    assert.equal(body.message, "Too many attempts. Please try again later.");
  });

  it("rate limits register attempts even when the submitted email changes", async () => {
    const response = await exhaustRateLimitWithBodyFactory(
      "/api/auth/register",
      env.authRegisterRateLimitMax,
      (attempt) => ({
        email: `rotated-register-${attempt}@example.com`,
        password: "short",
      })
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("rate limits forgot-password attempts", async () => {
    const response = await exhaustRateLimit(
      "/api/auth/forgot-password",
      env.authForgotPasswordRateLimitMax,
      {
        email: "not-an-email",
      }
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, "Too many attempts. Please try again later.");
    assert.equal(body.message, "Too many attempts. Please try again later.");
  });

  it("rate limits forgot-password attempts even when the submitted email changes", async () => {
    const response = await exhaustRateLimitWithBodyFactory(
      "/api/auth/forgot-password",
      env.authForgotPasswordRateLimitMax,
      (attempt) => ({
        email: `rotated-forgot-${attempt}`,
      })
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });
});

async function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function exhaustRateLimit(path: string, maxAttempts: number, body: unknown) {
  return exhaustRateLimitWithBodyFactory(path, maxAttempts, () => body);
}

async function exhaustRateLimitWithBodyFactory(
  path: string,
  maxAttempts: number,
  createBody: (attempt: number) => unknown
) {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    response = await postJson(path, createBody(attempt));
  }

  assert.ok(response);
  return response;
}
