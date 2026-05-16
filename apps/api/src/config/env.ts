import dotenv from "dotenv";

dotenv.config({ quiet: true });

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "",
  aiTimeoutMs: parseNumber(process.env.AI_TIMEOUT_MS, 55000),
  aiMaxOutputTokens: parseNumber(process.env.AI_MAX_OUTPUT_TOKENS, 2048),
});
