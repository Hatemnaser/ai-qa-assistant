import { DEVELOPMENT_CSRF_SECRET } from "../constants.js";
import {
  parseBoolean,
  parseCookieSameSite,
  parseList,
  parseRegistrationMode,
  parseStrictBoolean,
  parseStrictPositiveSafeInteger,
} from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadAuthLinkEnv({ source }: EnvLoadContext) {
  return {
    passwordResetPath: source.PASSWORD_RESET_PATH || "/reset-password",
    passwordResetTokenTtlMinutes: parseStrictPositiveSafeInteger(
      source.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      30,
      "PASSWORD_RESET_TOKEN_TTL_MINUTES"
    ),
    emailVerificationPath: source.EMAIL_VERIFICATION_PATH || "/verify-email",
    emailVerificationTokenTtlMinutes: parseStrictPositiveSafeInteger(
      source.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
      60,
      "EMAIL_VERIFICATION_TOKEN_TTL_MINUTES"
    ),
  };
}

export function loadAuthSecurityEnv({ nodeEnv, source }: EnvLoadContext) {
  return {
    cookieDomain: source.COOKIE_DOMAIN?.trim() || "",
    cookieSameSite: parseCookieSameSite(source.COOKIE_SAME_SITE, "lax"),
    cookieSecure: parseBoolean(source.COOKIE_SECURE, source.NODE_ENV === "production"),
    csrfCookieName: source.CSRF_COOKIE_NAME || "qa_csrf",
    csrfHeaderName: source.CSRF_HEADER_NAME || "X-CSRF-Token",
    csrfSecret: source.CSRF_SECRET || DEVELOPMENT_CSRF_SECRET,
    authRateLimitWindowMs: parseStrictPositiveSafeInteger(
      source.AUTH_RATE_LIMIT_WINDOW_MS,
      15 * 60 * 1000,
      "AUTH_RATE_LIMIT_WINDOW_MS"
    ),
    authAbuseStore: source.AUTH_ABUSE_STORE?.trim() || (nodeEnv === "production" ? "postgres" : "memory"),
    authGlobalRateLimitMax: parseStrictPositiveSafeInteger(source.AUTH_GLOBAL_RATE_LIMIT_MAX, 120, "AUTH_GLOBAL_RATE_LIMIT_MAX"),
    authEmailDailyMax: parseStrictPositiveSafeInteger(source.AUTH_EMAIL_DAILY_MAX, 100, "AUTH_EMAIL_DAILY_MAX"),
    authRecipientDailyMax: parseStrictPositiveSafeInteger(source.AUTH_RECIPIENT_DAILY_MAX, 5, "AUTH_RECIPIENT_DAILY_MAX"),
    publicRegistrationReleaseConfirmed: parseStrictBoolean(source.PUBLIC_REGISTRATION_RELEASE_CONFIRMED, false, "PUBLIC_REGISTRATION_RELEASE_CONFIRMED"),
    accountDeleteRateLimitMax: parseStrictPositiveSafeInteger(
      source.ACCOUNT_DELETE_RATE_LIMIT_MAX,
      5,
      "ACCOUNT_DELETE_RATE_LIMIT_MAX"
    ),
    authLoginRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_LOGIN_RATE_LIMIT_MAX,
      10,
      "AUTH_LOGIN_RATE_LIMIT_MAX"
    ),
    authRegisterRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_REGISTER_RATE_LIMIT_MAX,
      5,
      "AUTH_REGISTER_RATE_LIMIT_MAX"
    ),
    authForgotPasswordRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX,
      5,
      "AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX"
    ),
    authResetPasswordRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_RESET_PASSWORD_RATE_LIMIT_MAX,
      5,
      "AUTH_RESET_PASSWORD_RATE_LIMIT_MAX"
    ),
    authResendVerificationRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX,
      5,
      "AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX"
    ),
    authVerifyEmailRateLimitMax: parseStrictPositiveSafeInteger(
      source.AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX,
      20,
      "AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX"
    ),
    registrationMode: parseRegistrationMode(source.REGISTRATION_MODE, nodeEnv),
    registrationInviteCodeHashes: parseList(
      source.REGISTRATION_INVITE_CODE_HASHES,
      []
    ).map((hash) => hash.toLowerCase()),
    currentTermsVersion:
      source.CURRENT_TERMS_VERSION?.trim() ||
      (nodeEnv === "production" ? "" : "development-v1"),
    legalDocumentsPublishedConfirmed: parseBoolean(
      source.LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED,
      false
    ),
    chatRateLimitWindowMs: parseStrictPositiveSafeInteger(
      source.CHAT_RATE_LIMIT_WINDOW_MS,
      60 * 1000,
      "CHAT_RATE_LIMIT_WINDOW_MS"
    ),
    chatRateLimitMax: parseStrictPositiveSafeInteger(
      source.CHAT_RATE_LIMIT_MAX,
      60,
      "CHAT_RATE_LIMIT_MAX"
    ),
    guestChatRateLimitMax: parseStrictPositiveSafeInteger(
      source.GUEST_CHAT_RATE_LIMIT_MAX,
      30,
      "GUEST_CHAT_RATE_LIMIT_MAX"
    ),
    chatInFlightGlobalMax: parseStrictPositiveSafeInteger(
      source.CHAT_IN_FLIGHT_GLOBAL_MAX,
      4,
      "CHAT_IN_FLIGHT_GLOBAL_MAX"
    ),
    chatInFlightPerIpMax: parseStrictPositiveSafeInteger(
      source.CHAT_IN_FLIGHT_PER_IP_MAX,
      2,
      "CHAT_IN_FLIGHT_PER_IP_MAX"
    ),
    portabilityImportsEnabled: parseStrictBoolean(
      source.PORTABILITY_IMPORTS_ENABLED,
      nodeEnv !== "production",
      "PORTABILITY_IMPORTS_ENABLED"
    ),
  };
}
