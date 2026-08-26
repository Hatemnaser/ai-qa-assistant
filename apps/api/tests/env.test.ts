import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.ts";

function safeProductionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    AI_ENABLED: "true",
    APP_ORIGIN: "https://app.example.com",
    CORS_ORIGIN: "https://app.example.com",
    COOKIE_SECURE: "true",
    CSRF_SECRET: "production-csrf-secret-with-at-least-32-chars",
    DATABASE_URL: "postgresql://oddpath:secret@database.internal:5432/oddpath",
    EMAIL_FROM: "AI QA Assistant <no-reply@example.com>",
    EMAIL_OUTBOX_ENCRYPTION_SECRET: "production-email-outbox-encryption-secret-32-chars",
    EMAIL_PROVIDER: "smtp",
    GEMINI_API_KEY: "production-gemini-api-key",
    GEMINI_PAID_SERVICE_CONFIRMED: "true",
    GUEST_AI_ENABLED: "false",
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.com",
    SMTP_PASS: "smtp-password",
    SMTP_PORT: "587",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    TRUST_PROXY_HOPS: "1",
    USAGE_IP_HASH_SALT: "production-usage-ip-hash-salt-with-32-chars",
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

  it("requires a separate strong production email outbox encryption secret", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_OUTBOX_ENCRYPTION_SECRET: undefined })),
      /EMAIL_OUTBOX_ENCRYPTION_SECRET must be a strong secret/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_OUTBOX_ENCRYPTION_SECRET: "too-short" })),
      /EMAIL_OUTBOX_ENCRYPTION_SECRET must be a strong secret/
    );
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            EMAIL_OUTBOX_ENCRYPTION_SECRET:
              "replace-with-a-separate-random-secret-at-least-32-characters",
          })
        ),
      /EMAIL_OUTBOX_ENCRYPTION_SECRET must be a strong secret/
    );
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            EMAIL_OUTBOX_ENCRYPTION_SECRET:
              "production-csrf-secret-with-at-least-32-chars",
          })
        ),
      /must be separate from other application credentials/
    );
  });

  it("bounds email outbox polling, retries, batches, and timing equalization", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_OUTBOX_BATCH_SIZE: "51" })),
      /email outbox configuration/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_OUTBOX_MAX_ATTEMPTS: "0" })),
      /EMAIL_OUTBOX_MAX_ATTEMPTS must be a positive safe integer/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ AUTH_EMAIL_RESPONSE_FLOOR_MS: "5001" })),
      /email outbox configuration/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ AUTH_EMAIL_RESPONSE_FLOOR_MS: "0" })),
      /AUTH_EMAIL_RESPONSE_FLOOR_MS must be at least 250/
    );
  });

  it("bounds auth token lifetimes and rate-limit controls", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ PASSWORD_RESET_TOKEN_TTL_MINUTES: "121" })),
      /token lifetimes exceed safe bounds/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: "1441" })),
      /token lifetimes exceed safe bounds/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ AUTH_RATE_LIMIT_WINDOW_MS: "59999" })),
      /auth rate-limit configuration/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ AUTH_LOGIN_RATE_LIMIT_MAX: "101" })),
      /auth rate-limit configuration/
    );
  });

  it("strictly parses and safely bounds chat pre-body protection", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ CHAT_IN_FLIGHT_GLOBAL_MAX: "not-a-number" })),
      /CHAT_IN_FLIGHT_GLOBAL_MAX must be a positive safe integer/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ CHAT_IN_FLIGHT_PER_IP_MAX: "0" })),
      /CHAT_IN_FLIGHT_PER_IP_MAX must be a positive safe integer/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ CHAT_IN_FLIGHT_GLOBAL_MAX: "5" })),
      /chat request-protection configuration/
    );
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CHAT_IN_FLIGHT_GLOBAL_MAX: "1",
            CHAT_IN_FLIGHT_PER_IP_MAX: "2",
          })
        ),
      /chat request-protection configuration/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ CHAT_RATE_LIMIT_WINDOW_MS: "1.5" })),
      /CHAT_RATE_LIMIT_WINDOW_MS must be a positive safe integer/
    );

    const config = loadEnv(
      safeProductionEnv({
        CHAT_IN_FLIGHT_GLOBAL_MAX: "4",
        CHAT_IN_FLIGHT_PER_IP_MAX: "2",
      })
    );
    assert.equal(config.chatInFlightGlobalMax, 4);
    assert.equal(config.chatInFlightPerIpMax, 2);
  });

  it("rejects production values that can bypass the production guards", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ NODE_ENV: "prod" })),
      /NODE_ENV must be development, test, or production/
    );
  });

  it("requires an explicit managed database, HTTPS app origin, and trusted proxy path", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ DATABASE_URL: undefined })),
      /DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/app" })),
      /DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ DATABASE_URL: "postgresql://user:pass@[::1]:5432/app" })),
      /DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ DATABASE_URL: "https://database.example.com/oddpath" })),
      /DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ DATABASE_URL: "postgresql://user@database.internal:5432/app" })),
      /DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ APP_ORIGIN: "http://app.example.com" })),
      /APP_ORIGIN must be an explicit HTTPS origin/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ TRUST_PROXY_HOPS: undefined })),
      /TRUST_PROXY_HOPS must be exactly 1/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ TRUST_PROXY_HOPS: "2" })),
      /TRUST_PROXY_HOPS must be exactly 1/
    );
  });

  it("keeps the email-link origin inside the allowed browser origin", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ APP_ORIGIN: "https://other.example.com" })),
      /APP_ORIGIN must also be listed in CORS_ORIGIN/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ CORS_ORIGIN: "," })),
      /CORS_ORIGIN must contain at least one HTTPS origin/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ PASSWORD_RESET_PATH: "//other.example.com/reset" })),
      /must be same-origin absolute paths/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_VERIFICATION_PATH: "https://other.example.com/verify" })),
      /must be same-origin absolute paths/
    );
  });

  it("requires HTTPS CORS origins in production", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ CORS_ORIGIN: "http://app.example.com" })),
      /CORS_ORIGIN must contain explicit HTTPS origins/
    );
  });

  it("requires a strong production IP hash salt", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ USAGE_IP_HASH_SALT: "short" })),
      /USAGE_IP_HASH_SALT must be a strong secret/
    );
  });

  it("requires a paid Gemini key acknowledgement when production AI is enabled", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ GEMINI_API_KEY: undefined })),
      /GEMINI_API_KEY is required/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ GEMINI_PAID_SERVICE_CONFIRMED: "false" })),
      /GEMINI_PAID_SERVICE_CONFIRMED=true is required/
    );
  });

  it("allows a fail-closed production boot with AI disabled", () => {
    assert.doesNotThrow(() =>
      loadEnv(
        safeProductionEnv({
          AI_ENABLED: "false",
          GEMINI_API_KEY: undefined,
          GEMINI_PAID_SERVICE_CONFIRMED: undefined,
        })
      )
    );
  });

  it("fail-closes production registration and allows public registration only outside production", () => {
    const productionConfig = loadEnv(safeProductionEnv());
    const developmentConfig = loadEnv({ NODE_ENV: "development" });

    assert.equal(productionConfig.registrationMode, "disabled");
    assert.equal(productionConfig.currentTermsVersion, "");
    assert.equal(developmentConfig.registrationMode, "public");
    assert.equal(developmentConfig.currentTermsVersion, "development-v1");

    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CURRENT_TERMS_VERSION: "2026-08-12",
            REGISTRATION_MODE: "public",
          })
        ),
      /REGISTRATION_MODE may only be disabled or invite/
    );
  });

  it("requires a terms version and hashed codes for private-beta registration", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CURRENT_TERMS_VERSION: "2026-08-12",
            REGISTRATION_MODE: "invite",
          })
        ),
      /REGISTRATION_INVITE_CODE_HASHES is required/
    );
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CURRENT_TERMS_VERSION: "2026-08-12",
            REGISTRATION_INVITE_CODE_HASHES: "plaintext-invite",
            REGISTRATION_MODE: "invite",
          })
        ),
      /must be unique lowercase or uppercase SHA-256 hashes/
    );
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            REGISTRATION_INVITE_CODE_HASHES: "a".repeat(64),
            REGISTRATION_MODE: "invite",
          })
        ),
      /CURRENT_TERMS_VERSION is required/
    );

    const config = loadEnv(
      safeProductionEnv({
            CURRENT_TERMS_VERSION: "2026-08-12",
            REGISTRATION_INVITE_CODE_HASHES: "A".repeat(64),
            LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED: "true",
            REGISTRATION_MODE: "invite",
      })
    );

    assert.equal(config.registrationMode, "invite");
    assert.deepEqual(config.registrationInviteCodeHashes, ["a".repeat(64)]);
    assert.equal(config.currentTermsVersion, "2026-08-12");
    assert.equal(config.legalDocumentsPublishedConfirmed, true);
  });

  it("refuses to enable production registration while legal publication is unconfirmed", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CURRENT_TERMS_VERSION: "2026-08-12",
            REGISTRATION_INVITE_CODE_HASHES: "a".repeat(64),
            REGISTRATION_MODE: "invite",
          })
        ),
      /LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true is required/
    );
  });

  it("rejects malformed terms version identifiers even while registration is closed", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            CURRENT_TERMS_VERSION: "<draft version>",
          })
        ),
      /CURRENT_TERMS_VERSION contains invalid characters/
    );
  });

  it("rejects plaintext invite configuration even while registration is closed", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            REGISTRATION_INVITE_CODE_HASHES: "do-not-store-plaintext",
          })
        ),
      /must be unique lowercase or uppercase SHA-256 hashes/
    );
  });

  it("rejects unknown AI providers and model names", () => {
    assert.throws(
      () => loadEnv({ AI_PROVIDER: "unknown" }),
      /AI_PROVIDER must be gemini/
    );
    assert.throws(
      () => loadEnv({ AI_GENERAL_MODEL: "gemini-unbounded-experimental" }),
      /contains an unsupported Gemini model/
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

  it("rejects invalid production ports and email header injection", () => {
    assert.throws(
      () => loadEnv(safeProductionEnv({ PORT: "70000" })),
      /PORT must be an integer from 1 to 65535/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ SMTP_PORT: "70000" })),
      /SMTP_PORT must be from 1 to 65535/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ SMTP_PORT: "587.5" })),
      /SMTP_PORT must be from 1 to 65535/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ EMAIL_FROM: "Oddpath <no-reply@example.com>\r\nBcc: attacker@example.com" })),
      /EMAIL_FROM must not contain line breaks/
    );
  });

  it("rejects malformed or excessive request body limits", () => {
    assert.throws(
      () => loadEnv({ NODE_ENV: "development", REQUEST_BODY_LIMIT: "not-a-limit" }),
      /REQUEST_BODY_LIMIT must be a positive integer/
    );
    assert.throws(
      () => loadEnv({ NODE_ENV: "development", REQUEST_BODY_LIMIT: "0mb" }),
      /REQUEST_BODY_LIMIT must be a positive integer/
    );
    assert.throws(
      () => loadEnv(safeProductionEnv({ REQUEST_BODY_LIMIT: "26mb" })),
      /no greater than 25mb/
    );
    assert.equal(
      loadEnv({ NODE_ENV: "development", REQUEST_BODY_LIMIT: "512kb" }).requestBodyLimit,
      "512kb"
    );
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

  it("keeps private assets disabled without credentials", () => {
    const config = loadEnv({ NODE_ENV: "development" });

    assert.equal(config.privateAssetsEnabled, false);
    assert.equal(config.r2AccessKeyId, "");
    assert.throws(
      () => loadEnv({ PRIVATE_ASSETS_ENABLED: "false", R2_REGION: "eu" }),
      /endpoint, bucket, access key ID, and secret access key are required/
    );
  });

  it("fail-closes synchronous portability imports in production", () => {
    assert.equal(
      loadEnv(safeProductionEnv()).portabilityImportsEnabled,
      false
    );
    assert.equal(
      loadEnv(
        safeProductionEnv({ PORTABILITY_IMPORTS_ENABLED: "true" })
      ).portabilityImportsEnabled,
      true
    );
    assert.equal(loadEnv({ NODE_ENV: "development" }).portabilityImportsEnabled, true);
  });

  it("blocks production private assets until every storage activation gate passes", () => {
    assert.throws(
      () =>
        loadEnv(
          safeProductionEnv({
            PRIVATE_ASSETS_ENABLED: "true",
            R2_ACCESS_KEY_ID: "access-key",
            R2_BUCKET_NAME: "oddpath-private-assets",
            R2_ENDPOINT: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
            R2_REGION: "auto",
            R2_SECRET_ACCESS_KEY: "secret-key",
          })
        ),
      /real PostgreSQL restore\/cleanup and concurrency gate, EU R2 interruption smoke, production-scale latency\/timeout proof, and monitored scheduled cleanup validation pass/
    );
  });

  it("accepts only an explicit Cloudflare EU-jurisdiction R2 endpoint when enabled", () => {
    const base = {
      PRIVATE_ASSETS_ENABLED: "true",
      R2_ACCESS_KEY_ID: "access-key",
      R2_BUCKET_NAME: "oddpath-private-assets",
      R2_ENDPOINT: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
      R2_REGION: "auto",
      R2_SECRET_ACCESS_KEY: "secret-key",
    };

    assert.doesNotThrow(() => loadEnv(base));
    assert.throws(
      () => loadEnv({ ...base, R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` }),
      /EU-jurisdiction endpoint/
    );
    assert.throws(
      () => loadEnv({ ...base, R2_ENDPOINT: "https://evil.example.com" }),
      /EU-jurisdiction endpoint/
    );
    assert.throws(
      () => loadEnv({ ...base, R2_SECRET_ACCESS_KEY: undefined }),
      /endpoint, bucket, access key ID, and secret access key are required/
    );
  });

  it("bounds private asset URLs and release file sizes", () => {
    const base = {
      PRIVATE_ASSETS_ENABLED: "true",
      R2_ACCESS_KEY_ID: "access-key",
      R2_BUCKET_NAME: "oddpath-private-assets",
      R2_ENDPOINT: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
      R2_SECRET_ACCESS_KEY: "secret-key",
    };

    assert.throws(() => loadEnv({ ...base, ASSET_UPLOAD_URL_TTL_SECONDS: "901" }), /must not exceed 900/);
    assert.throws(() => loadEnv({ ...base, ASSET_MAX_IMAGE_BYTES: "4194305" }), /per-file limits exceed/);
  });

  it("parses global AI usage guard limits", () => {
    const config = loadEnv({
      AI_GLOBAL_CREDIT_LIMIT: "200",
      AI_GLOBAL_DAILY_CREDIT_LIMIT: "1200",
      AI_GLOBAL_DAILY_REQUEST_LIMIT: "300",
      AI_GLOBAL_MONTHLY_CREDIT_LIMIT: "12000",
      AI_GLOBAL_MONTHLY_REQUEST_LIMIT: "3000",
      AI_GLOBAL_REQUEST_LIMIT: "50",
      AI_GLOBAL_USAGE_WINDOW_MS: "900000",
    });

    assert.equal(config.aiGlobalCreditLimit, 200);
    assert.equal(config.aiGlobalDailyCreditLimit, 1200);
    assert.equal(config.aiGlobalDailyRequestLimit, 300);
    assert.equal(config.aiGlobalMonthlyCreditLimit, 12000);
    assert.equal(config.aiGlobalMonthlyRequestLimit, 3000);
    assert.equal(config.aiGlobalRequestLimit, 50);
    assert.equal(config.aiGlobalUsageWindowMs, 900000);

    for (const [name, value] of [
      ["AI_GLOBAL_CREDIT_LIMIT", "200x"],
      ["AI_GLOBAL_DAILY_REQUEST_LIMIT", "0"],
      ["AI_GLOBAL_MONTHLY_CREDIT_LIMIT", "9007199254740992"],
    ]) {
      assert.throws(
        () => loadEnv({ [name]: value }),
        new RegExp(`${name} must be a positive safe integer`)
      );
    }
  });

  it("parses AI kill switches and the total history limit", () => {
    const config = loadEnv({
      AI_ENABLED: "false",
      GUEST_AI_ENABLED: "false",
      MAX_HISTORY_TOTAL_CHARS: "12000",
    });

    assert.equal(config.aiEnabled, false);
    assert.equal(config.guestAiEnabled, false);
    assert.equal(config.maxHistoryTotalChars, 12000);
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

  it("parses bounded retention periods", () => {
    const config = loadEnv({
      AUTH_TOKEN_RETENTION_DAYS: "14",
      RETENTION_CLEANUP_BATCH_SIZE: "250",
      UNVERIFIED_ACCOUNT_RETENTION_DAYS: "21",
      USAGE_RECORD_RETENTION_DAYS: "45",
    });

    assert.equal(config.authTokenRetentionDays, 14);
    assert.equal(config.retentionCleanupBatchSize, 250);
    assert.equal(config.unverifiedAccountRetentionDays, 21);
    assert.equal(config.usageRecordRetentionDays, 45);
    assert.throws(
      () => loadEnv({ USAGE_RECORD_RETENTION_DAYS: "3651" }),
      /retention periods must not exceed 3650 days/
    );
    assert.throws(
      () => loadEnv({ UNVERIFIED_ACCOUNT_RETENTION_DAYS: "3651" }),
      /retention periods must not exceed 3650 days/
    );
    assert.throws(
      () => loadEnv({ UNVERIFIED_ACCOUNT_RETENTION_DAYS: "0" }),
      /must be a positive safe integer/
    );
    assert.throws(
      () => loadEnv({ USAGE_RECORD_RETENTION_DAYS: "31" }),
      /must be at least 32 days/
    );
    assert.throws(
      () => loadEnv({ RETENTION_CLEANUP_BATCH_SIZE: "1001" }),
      /must not exceed 1000/
    );
  });
});
