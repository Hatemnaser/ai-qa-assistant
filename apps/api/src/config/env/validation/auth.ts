import { DEVELOPMENT_CSRF_SECRET } from "../constants.js";
import {
  isExplicitHttpsOrigin,
  isSafeAppPath,
  isValidCookieDomain,
  isValidCookieName,
  isValidHeaderName,
} from "../checks.js";
import type { AppEnv } from "../load.js";
import type { EnvValidationContext } from "../types.js";

export function validateAuthShape(config: AppEnv) {
  if (config.cookieDomain && !isValidCookieDomain(config.cookieDomain)) {
    throw new Error(
      "Unsafe auth configuration: COOKIE_DOMAIN must be a plain domain without protocol, port, path, or wildcard."
    );
  }

  if (!isValidCookieName(config.csrfCookieName)) {
    throw new Error("Unsafe auth configuration: CSRF_COOKIE_NAME must be a valid cookie name.");
  }

  if (!isValidHeaderName(config.csrfHeaderName)) {
    throw new Error(
      "Unsafe auth configuration: CSRF_HEADER_NAME must be a valid HTTP header name."
    );
  }
}

export function validateRegistrationEnv(config: AppEnv) {
  if (
    config.registrationInviteCodeHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
    new Set(config.registrationInviteCodeHashes).size !==
      config.registrationInviteCodeHashes.length
  ) {
    throw new Error(
      "Unsafe registration configuration: invite codes must be unique lowercase or uppercase SHA-256 hashes."
    );
  }

  if (config.registrationMode === "invite" && config.registrationInviteCodeHashes.length === 0) {
    throw new Error(
      "Unsafe registration configuration: REGISTRATION_INVITE_CODE_HASHES is required when REGISTRATION_MODE=invite."
    );
  }

  if (config.currentTermsVersion && !isValidTermsVersion(config.currentTermsVersion)) {
    throw new Error(
      "Unsafe registration configuration: CURRENT_TERMS_VERSION contains invalid characters."
    );
  }

  if (config.registrationMode !== "disabled" && !config.currentTermsVersion) {
    throw new Error(
      "Unsafe registration configuration: CURRENT_TERMS_VERSION is required when registration is enabled."
    );
  }

  if (config.nodeEnv === "production" && config.registrationMode === "public") {
    throw new Error(
      "Unsafe production registration configuration: REGISTRATION_MODE may only be disabled or invite."
    );
  }

  if (
    config.nodeEnv === "production" &&
    config.registrationMode !== "disabled" &&
    !config.legalDocumentsPublishedConfirmed
  ) {
    throw new Error(
      "Unsafe production registration configuration: LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true is required before registration can be enabled."
    );
  }
}

export function validateAuthBounds(config: AppEnv) {
  if (
    config.passwordResetTokenTtlMinutes > 120 ||
    config.emailVerificationTokenTtlMinutes > 1_440
  ) {
    throw new Error("Unsafe auth token configuration: token lifetimes exceed safe bounds.");
  }

  const authRateLimitMaxima = [
    config.accountDeleteRateLimitMax,
    config.authLoginRateLimitMax,
    config.authRegisterRateLimitMax,
    config.authForgotPasswordRateLimitMax,
    config.authResetPasswordRateLimitMax,
    config.authResendVerificationRateLimitMax,
    config.authVerifyEmailRateLimitMax,
  ];
  if (
    config.authRateLimitWindowMs < 60_000 ||
    config.authRateLimitWindowMs > 60 * 60 * 1000 ||
    authRateLimitMaxima.some((maximum) => maximum > 100)
  ) {
    throw new Error("Unsafe auth rate-limit configuration: configured limits exceed safe bounds.");
  }

  if (
    config.chatRateLimitWindowMs < 1_000 ||
    config.chatRateLimitWindowMs > 60 * 60 * 1000 ||
    config.chatRateLimitMax > 1_000 ||
    config.guestChatRateLimitMax > config.chatRateLimitMax ||
    config.chatInFlightGlobalMax > 4 ||
    config.chatInFlightPerIpMax > 2 ||
    config.chatInFlightPerIpMax > config.chatInFlightGlobalMax
  ) {
    throw new Error(
      "Unsafe chat request-protection configuration: configured limits exceed safe bounds."
    );
  }
}

export function validateProductionAuthEnv(
  config: AppEnv,
  context: EnvValidationContext
) {
  if (!context.csrfSecretProvided) {
    throw new Error(
      "Unsafe production auth configuration: CSRF_SECRET must be explicitly configured."
    );
  }

  if (config.csrfSecret.length < 32 || config.csrfSecret === DEVELOPMENT_CSRF_SECRET) {
    throw new Error(
      "Unsafe production auth configuration: CSRF_SECRET must be a strong secret of at least 32 characters."
    );
  }

  if (config.cookieSameSite === "none" && !config.cookieSecure) {
    throw new Error(
      "Unsafe production auth configuration: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true."
    );
  }

  if (!config.cookieSecure) {
    throw new Error("Unsafe production auth configuration: COOKIE_SECURE must be true.");
  }

  if (!context.corsOriginProvided) {
    throw new Error(
      "Unsafe production auth configuration: CORS_ORIGIN must be explicitly configured."
    );
  }

  if (config.corsOrigins.length === 0) {
    throw new Error(
      "Unsafe production auth configuration: CORS_ORIGIN must contain at least one HTTPS origin."
    );
  }

  if (config.corsOrigins.includes("*")) {
    throw new Error(
      "Unsafe production auth configuration: CORS_ORIGIN=* is not allowed with credentialed requests."
    );
  }

  for (const origin of config.corsOrigins) {
    if (!isExplicitHttpsOrigin(origin)) {
      throw new Error(
        `Unsafe production auth configuration: CORS_ORIGIN must contain explicit HTTPS origins (${origin}).`
      );
    }
  }
}

export function validateProductionAppOriginEnv(
  config: AppEnv,
  context: EnvValidationContext
) {
  if (!context.appOriginProvided || !isExplicitHttpsOrigin(config.appOrigin)) {
    throw new Error(
      "Unsafe production auth configuration: APP_ORIGIN must be an explicit HTTPS origin."
    );
  }

  if (!config.corsOrigins.includes(config.appOrigin)) {
    throw new Error(
      "Unsafe production auth configuration: APP_ORIGIN must also be listed in CORS_ORIGIN."
    );
  }

  if (!isSafeAppPath(config.passwordResetPath) || !isSafeAppPath(config.emailVerificationPath)) {
    throw new Error(
      "Unsafe production auth configuration: password-reset and verification paths must be same-origin absolute paths."
    );
  }
}

function isValidTermsVersion(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
}
