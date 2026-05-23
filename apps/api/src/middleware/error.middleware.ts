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
      error: "Uploaded image is too large. Please use a smaller screenshot.",
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
    logError(error, req, 503);
    res.status(503).json({
      error: "Database is unavailable. Make sure PostgreSQL is running.",
      code: "DATABASE_UNAVAILABLE",
    });
    return;
  }

  const statusCode = getErrorStatus(error);
  const isAppError = error instanceof AppError;
  const message =
    isAppError && error.expose
      ? error.message
      : statusCode >= 500
        ? "Server error while processing the request."
        : getErrorMessage(error);

  logError(error, req, statusCode);

  res.status(statusCode).json({
    error: message,
    code: isAppError ? error.code : "API_ERROR",
  });
}

function logError(error: unknown, req: Request, statusCode: number) {
  const payload = {
    method: req.method,
    path: req.path,
    statusCode,
  };

  if (statusCode >= 500) {
    console.error("API Error:", payload, error);
    return;
  }

  console.warn("API Request Error:", payload, getErrorMessage(error));
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
      String((error as Record<string, unknown>).message || "").includes("ECONNREFUSED"))
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Server error while processing the request.";
}
