import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.ts";

describe("runtime env guards", () => {
  it("rejects CORS_ORIGIN=* with credentialed requests in production", () => {
    assert.throws(
      () =>
        loadEnv({
          CORS_ORIGIN: "*",
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
        COOKIE_SECURE: "true",
        NODE_ENV: "production",
      })
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
});
