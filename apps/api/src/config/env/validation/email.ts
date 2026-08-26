import {
  DEVELOPMENT_EMAIL_OUTBOX_SECRET,
  EXAMPLE_EMAIL_OUTBOX_SECRET,
} from "../constants.js";
import type { AppEnv } from "../load.js";
import type { EnvValidationContext } from "../types.js";

export function validateEmailBounds(config: AppEnv) {
  if (
    config.emailOutboxPollIntervalMs > 60_000 ||
    config.emailOutboxBatchSize > 50 ||
    config.emailOutboxMaxAttempts > 20 ||
    config.authEmailResponseFloorMs > 5_000
  ) {
    throw new Error("Unsafe email outbox configuration: configured limits exceed safe bounds.");
  }
}

export function validateProductionEmailEnv(
  config: AppEnv,
  context: EnvValidationContext
) {
  if (!config.emailProvider || config.emailProvider === "noop") {
    throw new Error("Unsafe production email configuration: EMAIL_PROVIDER=smtp is required.");
  }

  if (
    config.emailOutboxEncryptionSecret.length < 32 ||
    config.emailOutboxEncryptionSecret === DEVELOPMENT_EMAIL_OUTBOX_SECRET ||
    config.emailOutboxEncryptionSecret === EXAMPLE_EMAIL_OUTBOX_SECRET
  ) {
    throw new Error(
      "Unsafe production email configuration: EMAIL_OUTBOX_ENCRYPTION_SECRET must be a strong secret of at least 32 characters."
    );
  }

  if (
    config.emailOutboxEncryptionSecret === config.csrfSecret ||
    config.emailOutboxEncryptionSecret === config.usageIpHashSalt ||
    config.emailOutboxEncryptionSecret === config.smtpPass
  ) {
    throw new Error(
      "Unsafe production email configuration: EMAIL_OUTBOX_ENCRYPTION_SECRET must be separate from other application credentials."
    );
  }

  if (config.authEmailResponseFloorMs < 250) {
    throw new Error(
      "Unsafe production email configuration: AUTH_EMAIL_RESPONSE_FLOOR_MS must be at least 250."
    );
  }

  if (!config.emailFrom) {
    throw new Error(
      "Unsafe production email configuration: EMAIL_FROM must be explicitly configured."
    );
  }

  if (/[\r\n]/.test(config.emailFrom)) {
    throw new Error(
      "Unsafe production email configuration: EMAIL_FROM must not contain line breaks."
    );
  }

  if (config.emailProvider === "smtp") {
    if (!config.smtpHost) {
      throw new Error(
        "Unsafe production email configuration: SMTP_HOST must be explicitly configured."
      );
    }

    if (!context.smtpPortProvided) {
      throw new Error(
        "Unsafe production email configuration: SMTP_PORT must be explicitly configured."
      );
    }

    if (!Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65_535) {
      throw new Error("Unsafe production email configuration: SMTP_PORT must be from 1 to 65535.");
    }

    if (!config.smtpUser) {
      throw new Error(
        "Unsafe production email configuration: SMTP_USER must be explicitly configured."
      );
    }

    if (!config.smtpPass) {
      throw new Error(
        "Unsafe production email configuration: SMTP_PASS must be explicitly configured."
      );
    }
  }
}
