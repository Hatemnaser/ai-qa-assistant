import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { AppError, getErrorStatus } from "../lib/errors.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(`Route ${req.method} ${req.path} was not found.`, 404, "NOT_FOUND"));
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isEntityTooLargeError(error)) {
    res.status(413).json({
      error: "Upload is too large. Please use a smaller file.",
      code: "PAYLOAD_TOO_LARGE",
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Invalid request payload.",
      code: "VALIDATION_ERROR",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (isDatabaseUnavailableError(error)) {
    logError(error, req, res, 503);
    res.status(503).json({
      error: "Service is temporarily unavailable. Please try again later.",
      code: "DATABASE_UNAVAILABLE",
    });
    return;
  }

  if (isDatabaseSchemaMismatchError(error)) {
    logError(error, req, res, 500);
    res.status(500).json({
      error: "Service is temporarily unavailable. Please try again later.",
      code: "DATABASE_SCHEMA_OUT_OF_DATE",
    });
    return;
  }

  const statusCode = getErrorStatus(error);
  const isAppError = error instanceof AppError;
  const message = isAppError && error.expose
    ? error.message
    : statusCode >= 500
      ? "Server error while processing the request."
      : "Request could not be processed.";

  logError(error, req, res, statusCode);

  res.status(statusCode).json({
    error: message,
    code: isAppError ? error.code : "API_ERROR",
  });
}

function logError(error: unknown, req: Request, res: Response, statusCode: number) {
  const payload = {
    errorCode: getSafeErrorCode(error),
    errorName: getSafeErrorName(error),
    method: req.method,
    requestId: readRequestId(res),
    route: readSafeRouteTemplate(req),
    statusCode,
  };

  if (statusCode >= 500) {
    console.error("API Error:", payload);
    return;
  }

  console.warn("API Request Error:", payload);
}

const SAFE_ERROR_NAMES = new Set([
  "AggregateError",
  "AppError",
  "Error",
  "EvalError",
  "PrismaClientInitializationError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "ZodError",
]);

function getSafeErrorName(error: unknown) {
  if (!(error instanceof Error)) return "UnknownError";

  return SAFE_ERROR_NAMES.has(error.name) ? error.name : "UnknownError";
}

function readSafeRouteTemplate(req: Request) {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;

  return typeof routePath === "string" && /^\/[A-Za-z0-9_/:.*?()+-]{0,159}$/.test(routePath)
    ? routePath
    : "UNMATCHED_ROUTE";
}

function readRequestId(res: Response) {
  const requestId = res.locals?.requestId;

  return typeof requestId === "string" && /^[a-f0-9-]{36}$/i.test(requestId)
    ? requestId
    : undefined;
}

function getSafeErrorCode(error: unknown) {
  const code = error instanceof AppError
    ? error.code
    : error && typeof error === "object"
      ? (error as Record<string, unknown>).code
      : undefined;

  return typeof code === "string" && /^[A-Z][A-Z0-9_-]{0,63}$/.test(code) ? code : "UNKNOWN";
}

function isEntityTooLargeError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    (error as Record<string, unknown>).type === "entity.too.large"
  );
}

function isDatabaseUnavailableError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    ((error as Record<string, unknown>).code === "ECONNREFUSED" ||
      (error as Record<string, unknown>).code === "P1001" ||
      String((error as Record<string, unknown>).message || "").includes("ECONNREFUSED") ||
      String((error as Record<string, unknown>).message || "").includes("Can't reach database server"))
  );
}

function isDatabaseSchemaMismatchError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  const message = String(record.message || "");

  return record.code === "P2022" || message.includes("does not exist in the current database");
}
