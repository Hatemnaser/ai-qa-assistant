import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keyLength: number
) => Promise<Buffer>;

const PASSWORD_HASH_VERSION = "scrypt-v1";
const PASSWORD_KEY_LENGTH = 64;

// A valid, fixed scrypt hash used only to make a missing-user login perform the
// same expensive password derivation as a login for an existing password user.
// It is not an account credential and must never be used to authenticate.
export const LOGIN_DUMMY_PASSWORD_HASH =
  "scrypt-v1$oddpath-login-timing-salt-v1$3pp1blj4VVrFu36nnoPJVXqXMbNwzaFWTJND_7wDSU4k8XPfD84MxaXdTelRm9boHeYyPMMp0qZxVtgx8Kb6hg";

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH);

  return `${PASSWORD_HASH_VERSION}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [version, salt, encodedKey] = passwordHash.split("$");

  if (version !== PASSWORD_HASH_VERSION || !salt || !encodedKey) {
    return false;
  }

  const savedKey = Buffer.from(encodedKey, "base64url");
  const testKey = await scrypt(password, salt, savedKey.length);

  if (savedKey.length !== testKey.length) {
    return false;
  }

  return timingSafeEqual(savedKey, testKey);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createEmailVerificationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashEmailVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
