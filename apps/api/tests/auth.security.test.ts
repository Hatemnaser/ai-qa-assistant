import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createEmailVerificationToken,
  hashEmailVerificationToken,
  hashPassword,
  LOGIN_DUMMY_PASSWORD_HASH,
  verifyPassword,
} from "../src/modules/auth/auth.security.ts";

describe("auth password security helpers", () => {
  it("hashPassword produces different hashes for the same password because salts are random", async () => {
    const firstHash = await hashPassword("Password1");
    const secondHash = await hashPassword("Password1");

    assert.notEqual(firstHash, secondHash);
    assert.equal(await verifyPassword("Password1", firstHash), true);
    assert.equal(await verifyPassword("Password1", secondHash), true);
  });

  it("verifyPassword accepts the correct password and rejects an incorrect one", async () => {
    const passwordHash = await hashPassword("CorrectPassword1");

    assert.equal(await verifyPassword("CorrectPassword1", passwordHash), true);
    assert.equal(await verifyPassword("WrongPassword1", passwordHash), false);
  });

  it("verifyPassword rejects malformed hashes and unknown hash versions", async () => {
    assert.equal(await verifyPassword("Password1", "not-a-valid-hash"), false);
    assert.equal(await verifyPassword("Password1", "unknown-version$salt$key"), false);
  });

  it("keeps the login timing dummy as a structurally valid scrypt hash", async () => {
    const [, salt, encodedKey] = LOGIN_DUMMY_PASSWORD_HASH.split("$");

    assert.ok(salt);
    assert.ok(encodedKey);
    assert.equal(Buffer.from(encodedKey, "base64url").length, 64);
    assert.equal(await verifyPassword("an attacker supplied password", LOGIN_DUMMY_PASSWORD_HASH), false);
  });

  it("creates and hashes email verification tokens without returning the raw token as the hash", () => {
    const token = createEmailVerificationToken();
    const tokenHash = hashEmailVerificationToken(token);

    assert.ok(token.length >= 32);
    assert.notEqual(tokenHash, token);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
  });
});
