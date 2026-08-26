import { AppError, readErrorField } from "../../lib/errors.js";
import { logProviderAiError } from "../../lib/security-events.js";
import type { AiErrorDetails } from "./ai.types.js";

export interface GeminiErrorContext {
  operation?: string;
  provider?: string;
}

export function normalizeGeminiError(
  error: unknown,
  selectedModel: string,
  context: GeminiErrorContext = {}
) {
  if (error instanceof AppError) {
    logProviderQuotaOrModelError(error, context);

    return error;
  }

  if (isQuotaError(error)) {
    return withProviderQuotaOrModelLog(
      new AppError(
        `Gemini quota exceeded for ${selectedModel}. Please wait for the quota reset or manually select another Gemini model.`,
        429,
        "QUOTA_EXCEEDED"
      ),
      context
    );
  }

  if (isTemporaryUnavailableError(error)) {
    return withProviderQuotaOrModelLog(
      new AppError(
        `Gemini model ${selectedModel} is temporarily overloaded. Please try again later or manually select another Gemini model.`,
        503,
        "MODEL_UNAVAILABLE"
      ),
      context
    );
  }

  const status = getHttpStatus(error);

  if (status >= 400 && status <= 499) {
    return createSafeProviderRequestError(status);
  }

  return new AppError(
    "The AI provider request failed. Please try again.",
    502,
    "AI_PROVIDER_ERROR"
  );
}

function createSafeProviderRequestError(status: number) {
  if (status === 401 || status === 403) {
    return new AppError(
      "The AI provider is temporarily unavailable.",
      502,
      "AI_PROVIDER_AUTH_ERROR"
    );
  }

  if (status === 408) {
    return new AppError(
      "The AI provider request timed out. Please try again.",
      504,
      "AI_TIMEOUT"
    );
  }

  return new AppError(
    "The AI provider rejected the request.",
    502,
    "AI_PROVIDER_REQUEST_REJECTED"
  );
}

function withProviderQuotaOrModelLog(error: AppError, context: GeminiErrorContext) {
  logProviderQuotaOrModelError(error, context);

  return error;
}

function logProviderQuotaOrModelError(error: AppError, context: GeminiErrorContext) {
  if (error.code !== "QUOTA_EXCEEDED" && error.code !== "MODEL_UNAVAILABLE") return;

  logProviderAiError({
    errorCode: error.code,
    operation: context.operation || "unknown",
    provider: context.provider || "gemini",
  });
}

function getHttpStatus(error: unknown, fallbackStatus = 500) {
  const status = Number(getErrorStatus(error));
  const fallback = Number(fallbackStatus);

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  if (Number.isInteger(fallback) && fallback >= 400 && fallback <= 599) {
    return fallback;
  }

  return 500;
}

function getErrorStatus(error: unknown) {
  const details = getGeminiErrorDetails(error);

  return (
    details.httpStatus ||
    readErrorField(error, "status") ||
    readErrorField(error, "code") ||
    readErrorField(readErrorField(error, "response"), "status")
  );
}

function getGeminiErrorDetails(error: unknown): AiErrorDetails {
  const rawMessage = String(readErrorField(error, "message") || error || "");

  try {
    const parsed = JSON.parse(rawMessage) as Record<string, unknown>;
    const nestedError = (parsed.error || parsed) as Record<string, unknown>;
    const code = nestedError.code as string | number | undefined;

    return {
      code,
      httpStatus: typeof code === "number" ? code : undefined,
      message: String(nestedError.message || rawMessage),
      status: nestedError.status ? String(nestedError.status) : undefined,
    };
  } catch {
    const status = readErrorField(error, "status");
    const response = readErrorField(error, "response");

    return {
      code: readErrorField(error, "code") as string | number | undefined,
      httpStatus:
        typeof status === "number"
          ? status
          : typeof readErrorField(response, "status") === "number"
            ? (readErrorField(response, "status") as number)
            : undefined,
      message: rawMessage,
      status: readErrorField(error, "statusText")
        ? String(readErrorField(error, "statusText"))
        : undefined,
    };
  }
}

function isQuotaError(error: unknown) {
  const details = getGeminiErrorDetails(error);
  const status = getErrorStatus(error);
  const numericStatus = Number(status);
  const message = details.message.toLowerCase();
  const errorStatus = String(details.status || "").toLowerCase();
  const code = String(details.code || status || "").toLowerCase();

  return (
    numericStatus === 429 ||
    code.includes("429") ||
    message.includes("429") ||
    message.includes("quota") ||
    errorStatus.includes("resource_exhausted") ||
    code.includes("resource_exhausted") ||
    message.includes("rate limit")
  );
}

function isTemporaryUnavailableError(error: unknown) {
  const details = getGeminiErrorDetails(error);
  const status = getErrorStatus(error);
  const numericStatus = Number(status);
  const message = details.message.toLowerCase();
  const errorStatus = String(details.status || "").toLowerCase();

  return (
    numericStatus === 503 ||
    message.includes("503") ||
    errorStatus.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable")
  );
}
