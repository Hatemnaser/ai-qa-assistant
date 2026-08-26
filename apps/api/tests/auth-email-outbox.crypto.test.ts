import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuthEmailPayloadContext,
  decryptAuthEmailPayload,
  encryptAuthEmailPayload,
} from "../src/modules/auth/auth-email-outbox.crypto.ts";

describe("auth email outbox encryption", () => {
  const secret = "test-email-outbox-secret-that-is-long-enough";
  const context = buildAuthEmailPayloadContext({
    jobId: "job-1",
    kind: "PASSWORD_RESET",
    userId: "user-1",
  });

  it("round-trips a payload without exposing its URL", () => {
    const payload = {
      expiresAt: "2026-08-19T12:00:00.000Z",
      url: "https://oddpath.example/#/reset-password?token=raw-secret",
    };
    const encrypted = encryptAuthEmailPayload(payload, { context, secret });

    assert.equal(encrypted.includes("raw-secret"), false);
    assert.deepEqual(decryptAuthEmailPayload(encrypted, { context, secret }), payload);
  });

  it("rejects ciphertext copied into another job context", () => {
    const encrypted = encryptAuthEmailPayload(
      {
        expiresAt: "2026-08-19T12:00:00.000Z",
        url: "https://oddpath.example/#/verify-email?token=raw-secret",
      },
      { context, secret }
    );

    assert.throws(() =>
      decryptAuthEmailPayload(encrypted, {
        context: `${context}:other`,
        secret,
      })
    );
  });
});
