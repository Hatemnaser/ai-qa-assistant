export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(message: string, statusCode = 500, code = "APP_ERROR", expose = true) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
  }
}

export function getErrorStatus(error: unknown, fallbackStatus = 500) {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  const status = Number(readErrorField(error, "status") || readErrorField(error, "statusCode"));

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  return fallbackStatus;
}

export function readErrorField(error: unknown, field: string) {
  if (!error || typeof error !== "object") return undefined;

  return (error as Record<string, unknown>)[field];
}
