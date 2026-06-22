import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEmailVerificationUrl,
  buildPasswordResetUrl,
} from "../src/modules/auth/auth.email.ts";

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

function readHashToken(url: URL) {
  const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";

  return new URLSearchParams(hashQuery).get("token");
}
