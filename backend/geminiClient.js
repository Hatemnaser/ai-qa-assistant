const { GoogleGenAI } = require("@google/genai");
const { buildPrompt } = require("./prompts");

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const AI_TIMEOUT_MS = 55000;
const ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
];

function addHistoryContext(prompt, history) {
  const textHistory = Array.isArray(history)
    ? history
        .filter((item) => item && typeof item.content === "string" && item.content.trim())
        .slice(-8)
    : [];

  if (textHistory.length === 0) return prompt;

  const context = textHistory
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`)
    .join("\n");

  return `Recent conversation context:\n${context}\n\n${prompt}`;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("AI response timed out. Please try again."));
      }, timeoutMs);
    }),
  ]);
}

function getErrorStatus(error) {
  const details = getGeminiErrorDetails(error);
  return details.httpStatus || error?.status || error?.code || error?.response?.status;
}

function getGeminiErrorDetails(error) {
  const rawMessage = String(error?.message || error || "");

  try {
    const parsed = JSON.parse(rawMessage);
    const nestedError = parsed.error || parsed;

    return {
      code: nestedError.code,
      httpStatus: typeof nestedError.code === "number" ? nestedError.code : undefined,
      message: nestedError.message || rawMessage,
      status: nestedError.status,
    };
  } catch (parseError) {
    return {
      code: error?.code,
      httpStatus: error?.status || error?.response?.status,
      message: rawMessage,
      status: error?.statusText,
    };
  }
}

function isQuotaError(error) {
  const details = getGeminiErrorDetails(error);
  const status = getErrorStatus(error);
  const message = details.message.toLowerCase();
  const errorStatus = String(details.status || "").toLowerCase();

  return (
    status === 429 ||
    message.includes("429") ||
    message.includes("quota") ||
    errorStatus.includes("resource_exhausted") ||
    message.includes("rate limit")
  );
}

function isTemporaryUnavailableError(error) {
  const details = getGeminiErrorDetails(error);
  const status = getErrorStatus(error);
  const message = details.message.toLowerCase();
  const errorStatus = String(details.status || "").toLowerCase();

  return (
    status === 503 ||
    message.includes("503") ||
    errorStatus.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable")
  );
}

function createGeminiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeModel(model) {
  return ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

async function chat({ message, mode, model, history, image }) {
  if (!process.env.GEMINI_API_KEY) {
    throw createGeminiError(
      "GEMINI_API_KEY is not configured. Configure a Gemini API key before sending requests.",
      500,
      "MISSING_API_KEY"
    );
  }

  const selectedModel = normalizeModel(model || process.env.GEMINI_MODEL || DEFAULT_MODEL);
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const prompt = addHistoryContext(buildPrompt(mode, message), history);

  const contents =
    image && image.data && image.mimeType
      ? [
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          },
          {
            text: prompt,
          },
        ]
      : prompt;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: selectedModel,
        contents,
        config: {
          maxOutputTokens: 2048,
          temperature: 0.3,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
      AI_TIMEOUT_MS
    );

    return {
      reply: response.text,
      model: selectedModel,
    };
  } catch (error) {
    if (isQuotaError(error)) {
      throw createGeminiError(
        `Gemini quota exceeded for ${selectedModel}. Please wait for the quota reset or manually select another Gemini model.`,
        429,
        "QUOTA_EXCEEDED"
      );
    }

    if (isTemporaryUnavailableError(error)) {
      throw createGeminiError(
        `Gemini model ${selectedModel} is temporarily overloaded. Please try again later or manually select another Gemini model.`,
        503,
        "MODEL_UNAVAILABLE"
      );
    }

    if (String(error?.message || "").includes("timed out")) {
      error.status = 504;
    }

    throw error;
  }
}

module.exports = {
  ALLOWED_MODELS,
  DEFAULT_MODEL,
  chat,
  normalizeModel,
};
