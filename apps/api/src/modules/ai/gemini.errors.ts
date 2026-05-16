import { AppError, readErrorField } from "../../lib/errors.js";
import type { AiErrorDetails } from "./ai.types.js";

export function normalizeGeminiError(error: unknown, selectedModel: string) {
  if (error instanceof AppError) {
    return error;
  }

  if (isQuotaError(error)) {
    return new AppError(
      `Gemini quota exceeded for ${selectedModel}. Please wait for the quota reset or manually select another Gemini model.`,
      429,
      "QUOTA_EXCEEDED"
    );
  }

  if (isTemporaryUnavailableError(error)) {
    return new AppError(
      `Gemini model ${selectedModel} is temporarily overloaded. Please try again later or manually select another Gemini model.`,
      503,
      "MODEL_UNAVAILABLE"
    );
  }

  const status = getHttpStatus(error);

  if (status >= 400 && status <= 499) {
    const details = getGeminiErrorDetails(error);

    return new AppError(
      `Gemini request failed for ${selectedModel}: ${details.message}`,
      status,
      String(details.status || details.code || "GEMINI_REQUEST_FAILED")
    );
  }

  return error instanceof Error
    ? error
    : new AppError("Server error while processing the AI request.", 500, "AI_PROVIDER_ERROR");
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
