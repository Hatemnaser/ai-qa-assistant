import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.ts";

describe("runtime env guards", () => {
  it("rejects CORS_ORIGIN=* with credentialed requests in production", () => {
    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "*",
          CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
          COOKIE_SECURE: "true",
          NODE_ENV: "production",
        }),
      /CORS_ORIGIN=\* is not allowed/
    );
  });

  it("rejects COOKIE_SAME_SITE=none without COOKIE_SECURE=true", () => {
    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "https://app.example.com",
          CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
          COOKIE_SAME_SITE: "none",
          COOKIE_SECURE: "false",
          NODE_ENV: "production",
        }),
      /COOKIE_SAME_SITE=none requires COOKIE_SECURE=true/
    );
  });

  it("rejects production without COOKIE_SECURE=true", () => {
    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "https://app.example.com",
          CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
          COOKIE_SECURE: "false",
          NODE_ENV: "production",
        }),
      /COOKIE_SECURE must be true/
    );
  });

  it("rejects production without an explicit CORS_ORIGIN", () => {
    assert.throws(
      () =>
        loadEnv({
          CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
          COOKIE_SECURE: "true",
          NODE_ENV: "production",
        }),
      /CORS_ORIGIN must be explicitly configured/
    );
  });

  it("accepts a safe production auth configuration", () => {
    assert.doesNotThrow(() =>
      loadEnv({
        CORS_ORIGIN: "https://app.example.com",
        CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
        COOKIE_SECURE: "true",
        NODE_ENV: "production",
      })
    );
  });

  it("rejects production without an explicit strong CSRF secret", () => {
    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "https://app.example.com",
          COOKIE_SECURE: "true",
          NODE_ENV: "production",
        }),
      /CSRF_SECRET must be explicitly configured/
    );

    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "https://app.example.com",
          COOKIE_SECURE: "true",
          CSRF_SECRET: "short",
          NODE_ENV: "production",
        }),
      /CSRF_SECRET must be a strong secret/
    );
  });

  it("does not break local development config", () => {
    assert.doesNotThrow(() =>
      loadEnv({
        CORS_ORIGIN: "*",
        COOKIE_SAME_SITE: "none",
        COOKIE_SECURE: "false",
        NODE_ENV: "development",
      })
    );
  });

  it("parses stale reserved usage cleanup window", () => {
    const config = loadEnv({
      USAGE_STALE_RESERVED_MINUTES: "45",
    });

    assert.equal(config.usageStaleReservedMinutes, 45);
  });

  it("parses global AI usage guard limits", () => {
    const config = loadEnv({
      AI_GLOBAL_CREDIT_LIMIT: "200",
      AI_GLOBAL_REQUEST_LIMIT: "50",
      AI_GLOBAL_USAGE_WINDOW_MS: "900000",
    });

    assert.equal(config.aiGlobalCreditLimit, 200);
    assert.equal(config.aiGlobalRequestLimit, 50);
    assert.equal(config.aiGlobalUsageWindowMs, 900000);
  });

  it("parses password reset configuration", () => {
    const config = loadEnv({
      APP_ORIGIN: "https://app.example.com",
      AUTH_RESET_PASSWORD_RATE_LIMIT_MAX: "8",
      PASSWORD_RESET_PATH: "/account/reset-password",
      PASSWORD_RESET_TOKEN_TTL_MINUTES: "45",
    });

    assert.equal(config.appOrigin, "https://app.example.com");
    assert.equal(config.authResetPasswordRateLimitMax, 8);
    assert.equal(config.passwordResetPath, "/account/reset-password");
    assert.equal(config.passwordResetTokenTtlMinutes, 45);
  });

  it("parses email verification configuration", () => {
    const config = loadEnv({
      AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX: "7",
      AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX: "25",
      EMAIL_VERIFICATION_PATH: "/account/verify-email",
      EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: "90",
    });

    assert.equal(config.authResendVerificationRateLimitMax, 7);
    assert.equal(config.authVerifyEmailRateLimitMax, 25);
    assert.equal(config.emailVerificationPath, "/account/verify-email");
    assert.equal(config.emailVerificationTokenTtlMinutes, 90);
  });

  it("parses CSRF configuration", () => {
    const config = loadEnv({
      CSRF_COOKIE_NAME: "custom_csrf",
      CSRF_HEADER_NAME: "X-Custom-CSRF",
      CSRF_SECRET: "custom-development-csrf-secret",
    });

    assert.equal(config.csrfCookieName, "custom_csrf");
    assert.equal(config.csrfHeaderName, "X-Custom-CSRF");
    assert.equal(config.csrfSecret, "custom-development-csrf-secret");
  });
});
