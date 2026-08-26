import { DEVELOPMENT_EMAIL_OUTBOX_SECRET } from "../constants.js";
import {
  parseBoolean,
  parseEmailProvider,
  parseNumber,
  parseStrictNonNegativeSafeInteger,
  parseStrictPositiveSafeInteger,
} from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadEmailEnv({ nodeEnv, source }: EnvLoadContext) {
  return {
    emailProvider: parseEmailProvider(source.EMAIL_PROVIDER),
    emailFrom: source.EMAIL_FROM?.trim() || "",
    smtpHost: source.SMTP_HOST?.trim() || "",
    smtpPort: parseNumber(source.SMTP_PORT, 587),
    smtpUser: source.SMTP_USER?.trim() || "",
    smtpPass: source.SMTP_PASS || "",
    smtpSecure: parseBoolean(source.SMTP_SECURE, false),
    emailOutboxEncryptionSecret:
      source.EMAIL_OUTBOX_ENCRYPTION_SECRET?.trim() || DEVELOPMENT_EMAIL_OUTBOX_SECRET,
    emailOutboxPollIntervalMs: parseStrictPositiveSafeInteger(
      source.EMAIL_OUTBOX_POLL_INTERVAL_MS,
      5_000,
      "EMAIL_OUTBOX_POLL_INTERVAL_MS"
    ),
    emailOutboxBatchSize: parseStrictPositiveSafeInteger(
      source.EMAIL_OUTBOX_BATCH_SIZE,
      10,
      "EMAIL_OUTBOX_BATCH_SIZE"
    ),
    emailOutboxMaxAttempts: parseStrictPositiveSafeInteger(
      source.EMAIL_OUTBOX_MAX_ATTEMPTS,
      5,
      "EMAIL_OUTBOX_MAX_ATTEMPTS"
    ),
    authEmailResponseFloorMs: parseStrictNonNegativeSafeInteger(
      source.AUTH_EMAIL_RESPONSE_FLOOR_MS,
      nodeEnv === "production" ? 350 : 0,
      "AUTH_EMAIL_RESPONSE_FLOOR_MS"
    ),
  };
}
