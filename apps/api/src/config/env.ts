import dotenv from "dotenv";

dotenv.config({ quiet: true });

type CookieSameSite = "lax" | "none" | "strict";
type EmailProvider = "" | "noop" | "smtp";
type EnvSource = Record<string, string | undefined>;

const DEVELOPMENT_CSRF_SECRET = "development-csrf-secret-change-before-production";

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;

  return value.toLowerCase() === "true";
}

function parseList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCookieSameSite(value: string | undefined, fallback: CookieSameSite) {
  if (value === "lax" || value === "none" || value === "strict") return value;

  return fallback;
}

function parseEmailProvider(value: string | undefined): EmailProvider {
  if (!value) return "";

  const normalizedValue = value.toLowerCase();
  if (normalizedValue === "noop" || normalizedValue === "smtp") return normalizedValue;

  throw new Error("Unsafe auth configuration: EMAIL_PROVIDER must be one of: noop, smtp.");
}

export function loadEnv(source: EnvSource = process.env) {
  const loadedEnv = Object.freeze({
    nodeEnv: source.NODE_ENV || "development",
    port: parseNumber(source.PORT, 5000),
    corsOrigins: parseList(source.CORS_ORIGIN, [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]),
    requestBodyLimit: source.REQUEST_BODY_LIMIT || "25mb",
    databaseUrl:
      source.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public",
    appOrigin: source.APP_ORIGIN || "http://localhost:5173",
    passwordResetPath: source.PASSWORD_RESET_PATH || "/reset-password",
    passwordResetTokenTtlMinutes: parsePositiveInteger(
      source.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      30
    ),
    emailVerificationPath: source.EMAIL_VERIFICATION_PATH || "/verify-email",
    emailVerificationTokenTtlMinutes: parsePositiveInteger(
      source.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
      60
    ),
    emailProvider: parseEmailProvider(source.EMAIL_PROVIDER),
    emailFrom: source.EMAIL_FROM?.trim() || "",
    smtpHost: source.SMTP_HOST?.trim() || "",
    smtpPort: parsePositiveInteger(source.SMTP_PORT, 587),
    smtpUser: source.SMTP_USER?.trim() || "",
    smtpPass: source.SMTP_PASS || "",
    smtpSecure: parseBoolean(source.SMTP_SECURE, false),
    aiProvider: source.AI_PROVIDER || "gemini",
    geminiApiKey: source.GEMINI_API_KEY || "",
    geminiModel: source.GEMINI_MODEL || "",
    aiWorkflowRouterEnabled: source.AI_WORKFLOW_ROUTER_ENABLED !== "false",
    aiWorkflowRouterModel: source.AI_WORKFLOW_ROUTER_MODEL || "gemini-3.1-flash-lite",
    aiWorkflowRouterMinConfidence: parseNumber(source.AI_WORKFLOW_ROUTER_MIN_CONFIDENCE, 0.72),
    aiWorkflowRouterTimeoutMs: parseNumber(source.AI_WORKFLOW_ROUTER_TIMEOUT_MS, 8000),
    aiSummaryModel:
      source.AI_SUMMARY_MODEL ||
      source.AI_GENERAL_MODEL ||
      "gemini-3.1-flash-lite",
    aiSummaryTimeoutMs: parseNumber(source.AI_SUMMARY_TIMEOUT_MS, 15000),
    aiModelRouterEnabled: source.AI_MODEL_ROUTER_ENABLED !== "false",
    aiGeneralModel: source.AI_GENERAL_MODEL || "gemini-3.1-flash-lite",
    aiVisualModel: source.AI_VISUAL_MODEL || "gemini-2.5-flash",
    aiFallbackModel: source.AI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
    aiTimeoutMs: parseNumber(source.AI_TIMEOUT_MS, 55000),
    aiMaxOutputTokens: parseNumber(source.AI_MAX_OUTPUT_TOKENS, 2048),
    aiGlobalUsageWindowMs: parsePositiveInteger(source.AI_GLOBAL_USAGE_WINDOW_MS, 60 * 60 * 1000),
    aiGlobalRequestLimit: parsePositiveInteger(source.AI_GLOBAL_REQUEST_LIMIT, 1000),
    aiGlobalCreditLimit: parsePositiveInteger(source.AI_GLOBAL_CREDIT_LIMIT, 5000),
    projectDocumentEmbeddingsEnabled:
      source.PROJECT_DOCUMENT_EMBEDDINGS_ENABLED === "true",
    embeddingProvider: source.EMBEDDING_PROVIDER || "gemini",
    geminiEmbeddingModel: source.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    embeddingDimensions: parseNumber(source.EMBEDDING_DIMENSIONS, 768),
    embeddingTimeoutMs: parseNumber(source.EMBEDDING_TIMEOUT_MS, 15000),
    guestDailyCredits: parseNumber(source.GUEST_DAILY_CREDITS, 20),
    userDailyCredits: parseNumber(source.USER_DAILY_CREDITS, 100),
    usageTokensPerCredit: parseNumber(source.USAGE_TOKENS_PER_CREDIT, 1000),
    usageImageCredits: parseNumber(source.USAGE_IMAGE_CREDITS, 4),
    usageTextFileCredits: parseNumber(source.USAGE_TEXT_FILE_CREDITS, 1),
    usageRouterCredits: parseNumber(source.USAGE_ROUTER_CREDITS, 1),
    usageWindowHours: parseNumber(source.USAGE_WINDOW_HOURS, 24),
    usageStaleReservedMinutes: parsePositiveInteger(source.USAGE_STALE_RESERVED_MINUTES, 30),
    maxMessageChars: parseNumber(source.MAX_MESSAGE_CHARS, 3000),
    maxHistoryMessages: parseNumber(source.MAX_HISTORY_MESSAGES, 10),
    usageIpHashSalt: source.USAGE_IP_HASH_SALT || "development-usage-salt",
    cookieDomain: source.COOKIE_DOMAIN?.trim() || "",
    cookieSameSite: parseCookieSameSite(source.COOKIE_SAME_SITE, "lax"),
    cookieSecure: parseBoolean(source.COOKIE_SECURE, source.NODE_ENV === "production"),
    csrfCookieName: source.CSRF_COOKIE_NAME || "qa_csrf",
    csrfHeaderName: source.CSRF_HEADER_NAME || "X-CSRF-Token",
    csrfSecret: source.CSRF_SECRET || DEVELOPMENT_CSRF_SECRET,
    authRateLimitWindowMs: parsePositiveInteger(source.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authLoginRateLimitMax: parsePositiveInteger(source.AUTH_LOGIN_RATE_LIMIT_MAX, 10),
    authRegisterRateLimitMax: parsePositiveInteger(source.AUTH_REGISTER_RATE_LIMIT_MAX, 5),
    authForgotPasswordRateLimitMax: parsePositiveInteger(
      source.AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX,
      5
    ),
    authResetPasswordRateLimitMax: parsePositiveInteger(
      source.AUTH_RESET_PASSWORD_RATE_LIMIT_MAX,
      5
    ),
    authResendVerificationRateLimitMax: parsePositiveInteger(
      source.AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX,
      5
    ),
    authVerifyEmailRateLimitMax: parsePositiveInteger(
      source.AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX,
      20
    ),
    chatRateLimitWindowMs: parsePositiveInteger(source.CHAT_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    chatRateLimitMax: parsePositiveInteger(source.CHAT_RATE_LIMIT_MAX, 60),
    guestChatRateLimitMax: parsePositiveInteger(source.GUEST_CHAT_RATE_LIMIT_MAX, 30),
  });

  validateRuntimeEnv(loadedEnv, {
    corsOriginProvided: Boolean(source.CORS_ORIGIN?.trim()),
    csrfSecretProvided: Boolean(source.CSRF_SECRET?.trim()),
    smtpPortProvided: Boolean(source.SMTP_PORT?.trim()),
  });

  return loadedEnv;
}

export type AppEnv = ReturnType<typeof loadEnv>;

interface EnvValidationContext {
  corsOriginProvided: boolean;
  csrfSecretProvided: boolean;
  smtpPortProvided: boolean;
}

export function validateRuntimeEnv(config: AppEnv, context: EnvValidationContext) {
  if (config.cookieDomain && !isValidCookieDomain(config.cookieDomain)) {
    throw new Error(
      "Unsafe auth configuration: COOKIE_DOMAIN must be a plain domain without protocol, port, path, or wildcard."
    );
  }

  if (!isValidCookieName(config.csrfCookieName)) {
    throw new Error("Unsafe auth configuration: CSRF_COOKIE_NAME must be a valid cookie name.");
  }

  if (!isValidHeaderName(config.csrfHeaderName)) {
    throw new Error("Unsafe auth configuration: CSRF_HEADER_NAME must be a valid HTTP header name.");
  }

  if (config.nodeEnv !== "production") {
    return;
  }

  if (!context.csrfSecretProvided) {
    throw new Error("Unsafe production auth configuration: CSRF_SECRET must be explicitly configured.");
  }

  if (config.csrfSecret.length < 32 || config.csrfSecret === DEVELOPMENT_CSRF_SECRET) {
    throw new Error(
      "Unsafe production auth configuration: CSRF_SECRET must be a strong secret of at least 32 characters."
    );
  }

  if (config.cookieSameSite === "none" && !config.cookieSecure) {
    throw new Error("Unsafe production auth configuration: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.");
  }

  if (!config.cookieSecure) {
    throw new Error("Unsafe production auth configuration: COOKIE_SECURE must be true.");
  }

  if (!context.corsOriginProvided) {
    throw new Error("Unsafe production auth configuration: CORS_ORIGIN must be explicitly configured.");
  }

  if (config.corsOrigins.includes("*")) {
    throw new Error(
      "Unsafe production auth configuration: CORS_ORIGIN=* is not allowed with credentialed requests."
    );
  }

  for (const origin of config.corsOrigins) {
    if (!isExplicitOrigin(origin)) {
      throw new Error(
        `Unsafe production auth configuration: CORS_ORIGIN contains an invalid origin (${origin}).`
      );
    }
  }

  if (!config.emailProvider || config.emailProvider === "noop") {
    throw new Error("Unsafe production email configuration: EMAIL_PROVIDER=smtp is required.");
  }

  if (!config.emailFrom) {
    throw new Error("Unsafe production email configuration: EMAIL_FROM must be explicitly configured.");
  }

  if (config.emailProvider === "smtp") {
    if (!config.smtpHost) {
      throw new Error("Unsafe production email configuration: SMTP_HOST must be explicitly configured.");
    }

    if (!context.smtpPortProvided) {
      throw new Error("Unsafe production email configuration: SMTP_PORT must be explicitly configured.");
    }

    if (!config.smtpUser) {
      throw new Error("Unsafe production email configuration: SMTP_USER must be explicitly configured.");
    }

    if (!config.smtpPass) {
      throw new Error("Unsafe production email configuration: SMTP_PASS must be explicitly configured.");
    }
  }
}

function isExplicitOrigin(origin: string) {
  try {
    const parsed = new URL(origin);

    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === origin;
  } catch {
    return false;
  }
}

function isValidCookieDomain(domain: string) {
  const normalizedDomain = domain.startsWith(".") ? domain.slice(1) : domain;

  return (
    normalizedDomain.length > 0 &&
    !normalizedDomain.includes("*") &&
    !normalizedDomain.includes("/") &&
    !normalizedDomain.includes(":") &&
    /^[a-z0-9.-]+$/i.test(normalizedDomain)
  );
}

function isValidCookieName(name: string) {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

function isValidHeaderName(name: string) {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name);
}

export const env = loadEnv();
