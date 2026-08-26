import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertRegistrationAllowed,
  getPublicRegistrationConfig,
  hashInviteCode,
  type RegistrationPolicy,
} from "../src/modules/auth/registration-policy.ts";

const TERMS_VERSION = "2026-08-12";

describe("registration policy", () => {
  it("fail-closes disabled registration", () => {
    assert.throws(
      () =>
        assertRegistrationAllowed(
          { termsVersion: TERMS_VERSION },
          policy({ mode: "disabled" })
        ),
      { code: "REGISTRATION_DISABLED", statusCode: 403 }
    );
  });

  it("accepts only configured invite hashes and never needs plaintext config", () => {
    const inviteCode = "high-entropy-private-beta-code-4f56889a";
    const invitePolicy = policy({
      inviteCodeHashes: [hashInviteCode(inviteCode)],
      mode: "invite",
    });

    assert.doesNotThrow(() =>
      assertRegistrationAllowed({ inviteCode, termsVersion: TERMS_VERSION }, invitePolicy)
    );
    assert.throws(
      () =>
        assertRegistrationAllowed(
          { inviteCode: "wrong-code", termsVersion: TERMS_VERSION },
          invitePolicy
        ),
      { code: "INVITE_REQUIRED", statusCode: 403 }
    );
    assert.throws(
      () => assertRegistrationAllowed({ termsVersion: TERMS_VERSION }, invitePolicy),
      { code: "INVITE_REQUIRED", statusCode: 403 }
    );
  });

  it("rejects stale terms versions before creating an account", () => {
    assert.throws(
      () =>
        assertRegistrationAllowed(
          { termsVersion: "2026-01-01" },
          policy({ mode: "public" })
        ),
      { code: "TERMS_VERSION_OUTDATED", statusCode: 409 }
    );
  });

  it("publishes mode, version, and localized legal links without invite hashes", () => {
    const config = getPublicRegistrationConfig(
      policy({ inviteCodeHashes: [hashInviteCode("secret")], mode: "invite" })
    );

    assert.equal(config.mode, "invite");
    assert.equal(config.termsVersion, TERMS_VERSION);
    assert.equal(config.legalUrls.de.terms, "https://eluthira.com/de/oddpath/terms");
    assert.equal(config.legalUrls.en.privacy, "https://eluthira.com/oddpath/privacy");
    assert.deepEqual(config.legalUrls.ar, config.legalUrls.en);
    assert.equal("inviteCodeHashes" in config, false);
    assert.doesNotMatch(JSON.stringify(config), /secret/i);
    assert.doesNotMatch(JSON.stringify(config), /[a-f0-9]{64}/i);
  });
});

function policy(overrides: Partial<RegistrationPolicy>): RegistrationPolicy {
  return {
    currentTermsVersion: TERMS_VERSION,
    inviteCodeHashes: [],
    mode: "disabled",
    ...overrides,
  };
}
