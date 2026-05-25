import dotenv from "dotenv";

dotenv.config({ quiet: true });

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseCookieSameSite(value: string | undefined, fallback: "lax" | "none" | "strict") {
  if (value === "lax" || value === "none" || value === "strict") return value;

  return fallback;
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseNumber(process.env.PORT, 5000),
  corsOrigins: parseList(process.env.CORS_ORIGIN, [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "25mb",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public",
  aiProvider: process.env.AI_PROVIDER || "gemini",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "",
  aiWorkflowRouterEnabled: process.env.AI_WORKFLOW_ROUTER_ENABLED !== "false",
  aiWorkflowRouterModel: process.env.AI_WORKFLOW_ROUTER_MODEL || "gemini-3.1-flash-lite",
  aiWorkflowRouterMinConfidence: parseNumber(process.env.AI_WORKFLOW_ROUTER_MIN_CONFIDENCE, 0.72),
  aiWorkflowRouterTimeoutMs: parseNumber(process.env.AI_WORKFLOW_ROUTER_TIMEOUT_MS, 8000),
  aiModelRouterEnabled: process.env.AI_MODEL_ROUTER_ENABLED !== "false",
  aiGeneralModel: process.env.AI_GENERAL_MODEL || "gemini-3.1-flash-lite",
  aiVisualModel: process.env.AI_VISUAL_MODEL || "gemini-2.5-flash",
  aiFallbackModel: process.env.AI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
  aiTimeoutMs: parseNumber(process.env.AI_TIMEOUT_MS, 55000),
  aiMaxOutputTokens: parseNumber(process.env.AI_MAX_OUTPUT_TOKENS, 2048),
  guestDailyCredits: parseNumber(process.env.GUEST_DAILY_CREDITS, 20),
  userDailyCredits: parseNumber(process.env.USER_DAILY_CREDITS, 100),
  usageTokensPerCredit: parseNumber(process.env.USAGE_TOKENS_PER_CREDIT, 1000),
  usageImageCredits: parseNumber(process.env.USAGE_IMAGE_CREDITS, 4),
  usageTextFileCredits: parseNumber(process.env.USAGE_TEXT_FILE_CREDITS, 1),
  usageRouterCredits: parseNumber(process.env.USAGE_ROUTER_CREDITS, 1),
  usageWindowHours: parseNumber(process.env.USAGE_WINDOW_HOURS, 24),
  maxMessageChars: parseNumber(process.env.MAX_MESSAGE_CHARS, 3000),
  maxHistoryMessages: parseNumber(process.env.MAX_HISTORY_MESSAGES, 10),
  usageIpHashSalt: process.env.USAGE_IP_HASH_SALT || "development-usage-salt",
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || "",
  cookieSameSite: parseCookieSameSite(process.env.COOKIE_SAME_SITE, "lax"),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
});
