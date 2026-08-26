import {
  parseBoolean,
  parseNumber,
  parseStrictPositiveSafeInteger,
} from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadAiEnv({ source }: EnvLoadContext) {
  return {
    aiProvider: source.AI_PROVIDER || "gemini",
    aiEnabled: parseBoolean(source.AI_ENABLED, source.NODE_ENV !== "production"),
    guestAiEnabled: parseBoolean(
      source.GUEST_AI_ENABLED,
      source.NODE_ENV !== "production"
    ),
    geminiApiKey: source.GEMINI_API_KEY || "",
    geminiPaidServiceConfirmed: parseBoolean(
      source.GEMINI_PAID_SERVICE_CONFIRMED,
      false
    ),
    geminiModel: source.GEMINI_MODEL || "",
    aiWorkflowRouterEnabled: source.AI_WORKFLOW_ROUTER_ENABLED !== "false",
    aiWorkflowRouterModel:
      source.AI_WORKFLOW_ROUTER_MODEL || "gemini-3.1-flash-lite",
    aiWorkflowRouterMinConfidence: parseNumber(
      source.AI_WORKFLOW_ROUTER_MIN_CONFIDENCE,
      0.72
    ),
    aiWorkflowRouterTimeoutMs: parseNumber(source.AI_WORKFLOW_ROUTER_TIMEOUT_MS, 8000),
    aiSummaryModel:
      source.AI_SUMMARY_MODEL || source.AI_GENERAL_MODEL || "gemini-3.1-flash-lite",
    aiSummaryTimeoutMs: parseNumber(source.AI_SUMMARY_TIMEOUT_MS, 15000),
    aiModelRouterEnabled: source.AI_MODEL_ROUTER_ENABLED !== "false",
    aiGeneralModel: source.AI_GENERAL_MODEL || "gemini-3.1-flash-lite",
    aiVisualModel: source.AI_VISUAL_MODEL || "gemini-2.5-flash",
    aiFallbackModel: source.AI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
    aiTimeoutMs: parseNumber(source.AI_TIMEOUT_MS, 55000),
    aiMaxOutputTokens: parseNumber(source.AI_MAX_OUTPUT_TOKENS, 2048),
    aiGlobalUsageWindowMs: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_USAGE_WINDOW_MS,
      60 * 60 * 1000,
      "AI_GLOBAL_USAGE_WINDOW_MS"
    ),
    aiGlobalRequestLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_REQUEST_LIMIT,
      1000,
      "AI_GLOBAL_REQUEST_LIMIT"
    ),
    aiGlobalCreditLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_CREDIT_LIMIT,
      5000,
      "AI_GLOBAL_CREDIT_LIMIT"
    ),
    aiGlobalDailyRequestLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_DAILY_REQUEST_LIMIT,
      2500,
      "AI_GLOBAL_DAILY_REQUEST_LIMIT"
    ),
    aiGlobalDailyCreditLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_DAILY_CREDIT_LIMIT,
      10000,
      "AI_GLOBAL_DAILY_CREDIT_LIMIT"
    ),
    aiGlobalMonthlyRequestLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_MONTHLY_REQUEST_LIMIT,
      30000,
      "AI_GLOBAL_MONTHLY_REQUEST_LIMIT"
    ),
    aiGlobalMonthlyCreditLimit: parseStrictPositiveSafeInteger(
      source.AI_GLOBAL_MONTHLY_CREDIT_LIMIT,
      100000,
      "AI_GLOBAL_MONTHLY_CREDIT_LIMIT"
    ),
    projectDocumentEmbeddingsEnabled:
      source.PROJECT_DOCUMENT_EMBEDDINGS_ENABLED === "true",
    embeddingProvider: source.EMBEDDING_PROVIDER || "gemini",
    geminiEmbeddingModel: source.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
    embeddingDimensions: parseNumber(source.EMBEDDING_DIMENSIONS, 768),
    embeddingTimeoutMs: parseNumber(source.EMBEDDING_TIMEOUT_MS, 15000),
  };
}
