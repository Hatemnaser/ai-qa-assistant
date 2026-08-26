import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PAYLOAD_VERSION = "v1";
const IV_BYTES = 12;

export interface AuthEmailOutboxPayload {
  expiresAt: string;
  url: string;
}

export function encryptAuthEmailPayload(
  payload: AuthEmailOutboxPayload,
  input: {
    context: string;
    secret: string;
  }
) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(input.secret), iv);
  cipher.setAAD(Buffer.from(input.context, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PAYLOAD_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptAuthEmailPayload(
  encryptedPayload: string,
  input: {
    context: string;
    secret: string;
  }
): AuthEmailOutboxPayload {
  const [version, ivPart, tagPart, ciphertextPart, ...extra] = encryptedPayload.split(".");

  if (
    version !== PAYLOAD_VERSION ||
    !ivPart ||
    !tagPart ||
    !ciphertextPart ||
    extra.length > 0
  ) {
    throw new Error("Invalid auth email payload envelope.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(input.secret),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAAD(Buffer.from(input.context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<AuthEmailOutboxPayload>;

  if (
    typeof parsed.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.expiresAt)) ||
    typeof parsed.url !== "string" ||
    parsed.url.length < 1 ||
    parsed.url.length > 4096
  ) {
    throw new Error("Invalid auth email payload contents.");
  }

  return {
    expiresAt: parsed.expiresAt,
    url: parsed.url,
  };
}

export function buildAuthEmailPayloadContext(input: {
  jobId: string;
  kind: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
  userId: string;
}) {
  return `${input.jobId}:${input.userId}:${input.kind}`;
}

function deriveKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}
