import { createHash, timingSafeEqual } from "node:crypto";

import type { RegistrationMode } from "../../config/env.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export interface RegistrationPolicy {
  currentTermsVersion: string;
  inviteCodeHashes: readonly string[];
  mode: RegistrationMode;
}

export interface RegistrationConfigResponse {
  legalUrls: {
    ar: RegistrationLegalUrls;
    de: RegistrationLegalUrls;
    en: RegistrationLegalUrls;
  };
  mode: RegistrationMode;
  termsVersion: string | null;
}

interface RegistrationLegalUrls {
  privacy: string;
  terms: string;
}

export const registrationPolicy: RegistrationPolicy = {
  currentTermsVersion: env.currentTermsVersion,
  inviteCodeHashes: env.registrationInviteCodeHashes,
  mode: env.registrationMode,
};

export function getPublicRegistrationConfig(
  policy: RegistrationPolicy = registrationPolicy
): RegistrationConfigResponse {
  const englishLegalUrls = {
    privacy: "https://eluthira.com/oddpath/privacy",
    terms: "https://eluthira.com/oddpath/terms",
  };

  return {
    legalUrls: {
      // Eluthira has no reviewed Arabic legal route yet. The Arabic UI links
      // explicitly to the English documents instead of inventing a translation.
      ar: englishLegalUrls,
      de: {
        privacy: "https://eluthira.com/de/oddpath/privacy",
        terms: "https://eluthira.com/de/oddpath/terms",
      },
      en: englishLegalUrls,
    },
    mode: policy.mode,
    termsVersion: policy.currentTermsVersion || null,
  };
}

export function assertRegistrationAllowed(
  input: { inviteCode?: string; termsVersion: string },
  policy: RegistrationPolicy = registrationPolicy
) {
  if (policy.mode === "disabled") {
    throw new AppError("Registration is currently closed.", 403, "REGISTRATION_DISABLED");
  }

  if (input.termsVersion !== policy.currentTermsVersion) {
    throw new AppError(
      "The terms changed. Review the current documents and try again.",
      409,
      "TERMS_VERSION_OUTDATED"
    );
  }

  if (policy.mode === "invite" && !matchesInviteCode(input.inviteCode, policy.inviteCodeHashes)) {
    throw new AppError("A valid private beta invite is required.", 403, "INVITE_REQUIRED");
  }
}

export function hashInviteCode(inviteCode: string) {
  return createHash("sha256").update(inviteCode, "utf8").digest("hex");
}

function matchesInviteCode(inviteCode: string | undefined, allowedHashes: readonly string[]) {
  if (!inviteCode) return false;

  const submittedHash = Buffer.from(hashInviteCode(inviteCode), "hex");

  // Check every configured value rather than returning at the first match.
  // Environment validation guarantees equal-length, valid SHA-256 hashes.
  let matched = false;
  for (const allowedHash of allowedHashes) {
    matched = timingSafeEqual(submittedHash, Buffer.from(allowedHash, "hex")) || matched;
  }

  return matched;
}
