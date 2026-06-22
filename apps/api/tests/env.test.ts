import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.ts";

function safeProductionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    CORS_ORIGIN: "https://app.example.com",
    COOKIE_SECURE: "true",
    CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
    EMAIL_FROM: "AI QA Assistant <no-reply@example.com>",
    EMAIL_PROVIDER: "smtp",
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.com",
    SMTP_PASS: "smtp-password",
    SMTP_PORT: "587",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    ...overrides,
  };
}

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
      loadEnv(safeProductionEnv())
    );
  });

  it("rejects EMAIL_PROVIDER=noop in production", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            EMAIL_PROVIDER: "noop",
          })
        ),
      /EMAIL_PROVIDER=smtp is required/
    );
  });

  it("rejects incomplete SMTP production configuration", () => {
    const missingConfigCases: Array<[string, RegExp]> = [
      ["EMAIL_FROM", /EMAIL_FROM must be explicitly configured/],
      ["SMTP_HOST", /SMTP_HOST must be explicitly configured/],
      ["SMTP_PORT", /SMTP_PORT must be explicitly configured/],
      ["SMTP_USER", /SMTP_USER must be explicitly configured/],
      ["SMTP_PASS", /SMTP_PASS must be explicitly configured/],
    ];

    for (const [key, expectedError] of missingConfigCases) {
      assert.throws(
        () =>
          loadEnv(
            safeProductionEnv({
              [key]: undefined,
            })
          ),
        expectedError
      );
    }
  });

  it("parses complete SMTP production configuration", () => {
    const config = loadEnv(safeProductionEnv());

    assert.equal(config.emailProvider, "smtp");
    assert.equal(config.emailFrom, "AI QA Assistant <no-reply@example.com>");
    assert.equal(config.smtpHost, "smtp.example.com");
    assert.equal(config.smtpPort, 587);
    assert.equal(config.smtpUser, "smtp-user");
    assert.equal(config.smtpPass, "smtp-password");
    assert.equal(config.smtpSecure, true);
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

  it("allows local development email provider defaults and explicit noop", () => {
    const defaultConfig = loadEnv({
      NODE_ENV: "development",
    });
    const noopConfig = loadEnv({
      EMAIL_PROVIDER: "noop",
      NODE_ENV: "test",
    });

    assert.equal(defaultConfig.emailProvider, "");
    assert.equal(noopConfig.emailProvider, "noop");
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
