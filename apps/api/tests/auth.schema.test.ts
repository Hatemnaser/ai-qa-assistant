import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "../src/modules/auth/auth.schema.ts";

const VALID_EMAIL = "person@example.com";
const VALID_MIN_PASSWORD = "violet river 42";
const VALID_RESET_TOKEN = "a".repeat(24);
const OVER_MAX_PASSWORD = `${"A".repeat(PASSWORD_MAX_LENGTH)}1`;

describe("auth password schemas", () => {
  it("register rejects empty passwords", () => {
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ password: "" })),
      "password",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  });

  it("register rejects passwords shorter than the minimum", () => {
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ password: "Pass1" })),
      "password",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  });

  it("register accepts passphrases exactly at the minimum", () => {
    const result = registerRequestSchema.safeParse(registerPayload({ password: VALID_MIN_PASSWORD }));

    assert.equal(result.success, true);
  });

  it("register rejects passwords over the maximum", () => {
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ password: OVER_MAX_PASSWORD })),
      "password",
      `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
    );
  });

  it("register does not impose character-composition rules", () => {
    assert.equal(
      registerRequestSchema.safeParse(registerPayload({ password: "987654321098765" })).success,
      true
    );
    assert.equal(
      registerRequestSchema.safeParse(registerPayload({ password: "VioletRiverTrail" })).success,
      true
    );
  });

  it("register rejects a common password regardless of casing", () => {
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ password: "PasswordPassword" })),
      "password",
      "Choose a less common password or passphrase."
    );
  });

  it("register requires explicit acceptance and a document version", () => {
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ termsAccepted: false })),
      "termsAccepted",
      "You must accept the current terms and privacy notice."
    );
    assertValidationError(
      registerRequestSchema.safeParse(registerPayload({ termsVersion: "" })),
      "termsVersion",
      "String must contain at least 1 character(s)"
    );
  });

  it("reset-password rejects empty new passwords", () => {
    assertValidationError(
      resetPasswordRequestSchema.safeParse(resetPayload({ newPassword: "" })),
      "newPassword",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  });

  it("reset-password rejects new passwords shorter than the minimum", () => {
    assertValidationError(
      resetPasswordRequestSchema.safeParse(resetPayload({ newPassword: "Pass1" })),
      "newPassword",
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  });

  it("reset-password accepts new passphrases exactly at the minimum", () => {
    const result = resetPasswordRequestSchema.safeParse(resetPayload({ newPassword: VALID_MIN_PASSWORD }));

    assert.equal(result.success, true);
  });

  it("reset-password rejects new passwords over the maximum", () => {
    assertValidationError(
      resetPasswordRequestSchema.safeParse(resetPayload({ newPassword: OVER_MAX_PASSWORD })),
      "newPassword",
      `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
    );
  });

  it("reset-password applies the same common-password blocklist as registration", () => {
    assertValidationError(
      resetPasswordRequestSchema.safeParse(resetPayload({ newPassword: "passwordpassword" })),
      "newPassword",
      "Choose a less common password or passphrase."
    );
  });

  it("login rejects empty passwords", () => {
    assertValidationError(
      loginRequestSchema.safeParse(loginPayload({ password: "" })),
      "password",
      "Password is required."
    );
  });

  it("login rejects passwords longer than the maximum before password verification", () => {
    assertValidationError(
      loginRequestSchema.safeParse(loginPayload({ password: OVER_MAX_PASSWORD })),
      "password",
      `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`
    );
  });

  it("login keeps new-password length and blocklist rules out of credential verification", () => {
    const result = loginRequestSchema.safeParse(loginPayload({ password: "12345678" }));

    assert.equal(result.success, true);
  });

  it("verify-email requires a plausible token", () => {
    assertValidationError(
      verifyEmailRequestSchema.safeParse({ token: "short" }),
      "token",
      "A valid verification token is required."
    );
    assert.equal(verifyEmailRequestSchema.safeParse({ token: VALID_RESET_TOKEN }).success, true);
  });

  it("resend-verification normalizes email addresses", () => {
    const result = resendVerificationRequestSchema.safeParse({ email: " PERSON@EXAMPLE.COM " });

    assert.equal(result.success, true);

    if (result.success) {
      assert.equal(result.data.email, "person@example.com");
    }
  });
});

function registerPayload(
  overrides: Partial<{
    email: string;
    inviteCode: string;
    password: string;
    termsAccepted: boolean;
    termsVersion: string;
  }> = {}
) {
  return {
    email: VALID_EMAIL,
    password: VALID_MIN_PASSWORD,
    termsAccepted: true,
    termsVersion: "development-v1",
    ...overrides,
  };
}

function resetPayload(overrides: Partial<{ newPassword: string; token: string }> = {}) {
  return {
    newPassword: VALID_MIN_PASSWORD,
    token: VALID_RESET_TOKEN,
    ...overrides,
  };
}

function loginPayload(overrides: Partial<{ email: string; password: string }> = {}) {
  return {
    email: VALID_EMAIL,
    password: VALID_MIN_PASSWORD,
    ...overrides,
  };
}

interface ValidationResult {
  error?: {
    issues: Array<{
      message: string;
      path: Array<string | number>;
    }>;
  };
  success: boolean;
}

function assertValidationError(result: ValidationResult, path: string, message: string) {
  assert.equal(result.success, false);

  if (!result.error) {
    return;
  }

  assert.ok(
    result.error.issues.some((issue) => issue.path.join(".") === path && issue.message === message),
    `Expected validation issue for ${path}: ${message}`
  );
}
