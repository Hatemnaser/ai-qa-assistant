import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";

import { env } from "../src/config/env.ts";
import { createApp } from "../src/app.ts";
import { resetAuthRateLimitersForTests } from "../src/modules/auth/auth.rateLimit.ts";
import { PASSWORD_MAX_LENGTH } from "../src/modules/auth/auth.schema.ts";
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

afterEach(() => {
  resetAuthRateLimitersForTests();
});

describe("POST /api/auth", () => {
  it("returns a public registration config without invite material", async () => {
    const response = await fetch(`${baseUrl}/api/auth/registration-config`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(body.mode, "public");
    assert.equal(body.termsVersion, "development-v1");
    assert.equal(body.legalUrls.de.terms, "https://eluthira.com/de/oddpath/terms");
    assert.equal("inviteCodeHashes" in body, false);
    assert.doesNotMatch(serialized, /REGISTRATION_INVITE_CODE_HASHES/);
    assert.doesNotMatch(serialized, /[a-f0-9]{64}/i);
  });

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

  it("returns validation errors for oversized login passwords", async () => {
    const response = await postJson("/api/auth/login", {
      email: "person@example.com",
      password: `${"A".repeat(PASSWORD_MAX_LENGTH)}1`,
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid request payload.");
    assert.ok(
      body.issues.some(
        (issue: { message?: string; path?: string }) =>
          issue.path === "password" &&
          issue.message === `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
      )
    );
  });

  it("requires a session cookie for the current user route", async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("clears the auth cookie on logout", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      headers: csrfHeaders,
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
    assert.match(response.headers.get("retry-after") || "", /^\d+$/);
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
    assert.equal(response.headers.get("connection"), "close");
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("applies the IP limit before parsing a malformed auth body", async () => {
    for (let attempt = 0; attempt < env.authLoginRateLimitMax; attempt += 1) {
      await postJson("/api/auth/login", {
        email: `malformed-limit-${attempt}@example.com`,
      });
    }

    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      body: "{",
      headers: {
        "content-type": "application/json",
        ...csrfHeaders,
      },
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("cannot bypass the login pre-body limit with Express-equivalent casing", async () => {
    const response = await exhaustRateLimitWithBodyFactory(
      "/api/auth/LOGIN",
      env.authLoginRateLimitMax,
      (attempt) => ({ email: `case-variant-${attempt}@example.com` })
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("cannot bypass the login pre-body limit with a trailing slash", async () => {
    const response = await exhaustRateLimitWithBodyFactory(
      "/api/auth/login/",
      env.authLoginRateLimitMax,
      (attempt) => ({ email: `slash-variant-${attempt}@example.com` })
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
  });

  it("applies the IP limit before buffering an oversized auth body", async () => {
    for (let attempt = 0; attempt < env.authLoginRateLimitMax; attempt += 1) {
      await postJson("/api/auth/login", {
        email: `oversized-limit-${attempt}@example.com`,
      });
    }

    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      body: JSON.stringify({ email: "person@example.com", password: "x".repeat(20_000) }),
      headers: {
        "content-type": "application/json",
        ...csrfHeaders,
      },
      method: "POST",
    });
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

  it("rate limits reset-password attempts without logging query tokens", async () => {
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    let response: Response;
    try {
      response = await exhaustRateLimit(
        "/api/auth/reset-password?token=raw-reset-token",
        env.authResetPasswordRateLimitMax,
        {
          newPassword: "short",
          token: "",
        }
      );
    } finally {
      console.warn = () => {};
    }

    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, "Too many attempts. Please try again later.");
    assert.equal(body.message, "Too many attempts. Please try again later.");
    assert.ok(warnings.length > 0);
    assert.ok(warnings.every((warning) => !warning.includes("raw-reset-token")));

    const event = JSON.parse(warnings.at(-1) || "{}") as { route?: string };
    assert.equal(event.route, "/api/auth/reset-password");
  });

  it("rate limits resend-verification attempts", async () => {
    const response = await exhaustRateLimit(
      "/api/auth/resend-verification",
      env.authResendVerificationRateLimitMax,
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

  it("rate limits verify-email attempts", async () => {
    const response = await exhaustRateLimit(
      "/api/auth/verify-email",
      env.authVerifyEmailRateLimitMax,
      {
        token: "short",
      }
    );
    const body = await response.json();

    assert.equal(response.status, 429);
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.error, "Too many attempts. Please try again later.");
    assert.equal(body.message, "Too many attempts. Please try again later.");
    assert.match(response.headers.get("retry-after") || "", /^\d+$/);
  });
});

async function postJson(path: string, body: unknown) {
  const csrfHeaders = await getCsrfHeaders(baseUrl);

  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...csrfHeaders,
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
