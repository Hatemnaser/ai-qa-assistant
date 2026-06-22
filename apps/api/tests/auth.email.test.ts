import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { loadEnv } from "../src/config/env.ts";
import {
  type AuthEmailTransporter,
  InMemoryAuthEmailService,
  NoopAuthEmailService,
  SmtpAuthEmailService,
  buildEmailVerificationUrl,
  buildPasswordResetUrl,
  createAuthEmailService,
} from "../src/modules/auth/auth.email.ts";

const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

afterEach(() => {
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

describe("auth email URL builders", () => {
  it("puts email verification tokens inside the hash fragment for hash routes", () => {
    const verificationUrl = buildEmailVerificationUrl("verification-token", {
      appOrigin: "https://app.example.com",
      verificationPath: "/#/verify-email",
    });
    const url = new URL(verificationUrl);

    assert.equal(url.origin, "https://app.example.com");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(url.hash, "#/verify-email?token=verification-token");
    assert.equal(readHashToken(url), "verification-token");
  });

  it("puts password reset tokens inside the hash fragment for hash routes", () => {
    const resetUrl = buildPasswordResetUrl("reset-token", {
      appOrigin: "https://app.example.com",
      resetPath: "/#/reset-password",
    });
    const url = new URL(resetUrl);

    assert.equal(url.origin, "https://app.example.com");
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(url.hash, "#/reset-password?token=reset-token");
    assert.equal(readHashToken(url), "reset-token");
  });

  it("keeps ordinary path routes supported", () => {
    const verificationUrl = buildEmailVerificationUrl("verification-token", {
      appOrigin: "https://app.example.com",
      verificationPath: "/verify-email",
    });
    const url = new URL(verificationUrl);

    assert.equal(url.pathname, "/verify-email");
    assert.equal(url.searchParams.get("token"), "verification-token");
    assert.equal(url.hash, "");
  });
});

describe("auth email provider", () => {
  it("uses in-memory delivery by default outside production", () => {
    const config = loadEnv({
      NODE_ENV: "test",
    });

    const service = createAuthEmailService(config);

    assert.ok(service instanceof InMemoryAuthEmailService);
  });

  it("allows explicit noop delivery outside production", () => {
    const config = loadEnv({
      EMAIL_PROVIDER: "noop",
      NODE_ENV: "development",
    });

    const service = createAuthEmailService(config);

    assert.ok(service instanceof NoopAuthEmailService);
  });

  it("uses SMTP delivery when EMAIL_PROVIDER=smtp", () => {
    const config = loadEnv({
      EMAIL_FROM: "AI QA Assistant <no-reply@example.com>",
      EMAIL_PROVIDER: "smtp",
      NODE_ENV: "test",
      SMTP_HOST: "smtp.example.com",
      SMTP_PASS: "smtp-password",
      SMTP_PORT: "587",
      SMTP_USER: "smtp-user",
    });

    const service = createAuthEmailService(config);

    assert.ok(service instanceof SmtpAuthEmailService);
  });

  it("sends password reset email through the SMTP transporter", async () => {
    const sentMessages: unknown[] = [];
    const service = createSmtpEmailService(sentMessages);
    const resetUrl = "https://app.example.com/#/reset-password?token=raw-reset-token";

    await service.sendPasswordResetEmail({
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
      resetUrl,
      to: "person@example.com",
    });

    assert.equal(sentMessages.length, 1);
    const message = sentMessages[0] as {
      from?: string;
      subject?: string;
      text?: string;
      to?: string;
    };
    assert.equal(message.from, "AI QA Assistant <no-reply@example.com>");
    assert.equal(message.to, "person@example.com");
    assert.equal(message.subject, "Reset your AI QA Assistant password");
    assert.match(message.text || "", /reset your AI QA Assistant password/i);
    assert.match(message.text || "", new RegExp(escapeRegExp(resetUrl)));
  });

  it("sends email verification email through the SMTP transporter", async () => {
    const sentMessages: unknown[] = [];
    const service = createSmtpEmailService(sentMessages);
    const verificationUrl = "https://app.example.com/#/verify-email?token=raw-verification-token";

    await service.sendEmailVerificationEmail({
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
      to: "person@example.com",
      verificationUrl,
    });

    assert.equal(sentMessages.length, 1);
    const message = sentMessages[0] as {
      from?: string;
      subject?: string;
      text?: string;
      to?: string;
    };
    assert.equal(message.from, "AI QA Assistant <no-reply@example.com>");
    assert.equal(message.to, "person@example.com");
    assert.equal(message.subject, "Verify your AI QA Assistant email");
    assert.match(message.text || "", /verify your AI QA Assistant email/i);
    assert.match(message.text || "", new RegExp(escapeRegExp(verificationUrl)));
  });

  it("does not log raw reset or verification tokens while sending", async () => {
    const sentMessages: unknown[] = [];
    const service = createSmtpEmailService(sentMessages);
    const logs: string[] = [];
    console.warn = (...values: unknown[]) => {
      logs.push(values.map(String).join(" "));
    };
    console.error = (...values: unknown[]) => {
      logs.push(values.map(String).join(" "));
    };

    await service.sendPasswordResetEmail({
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
      resetUrl: "https://app.example.com/#/reset-password?token=raw-reset-token",
      to: "person@example.com",
    });
    await service.sendEmailVerificationEmail({
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
      to: "person@example.com",
      verificationUrl: "https://app.example.com/#/verify-email?token=raw-verification-token",
    });

    const logOutput = logs.join("\n");
    assert.equal(logOutput.includes("raw-reset-token"), false);
    assert.equal(logOutput.includes("raw-verification-token"), false);
  });
});

function createSmtpEmailService(sentMessages: unknown[]) {
  const transporter = {
    async sendMail(message) {
      sentMessages.push(message);
    },
  } satisfies AuthEmailTransporter;

  return new SmtpAuthEmailService({
    from: "AI QA Assistant <no-reply@example.com>",
    transporter,
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readHashToken(url: URL) {
  const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";

  return new URLSearchParams(hashQuery).get("token");
}
