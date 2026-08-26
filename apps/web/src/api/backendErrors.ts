import { t } from "../i18n/useI18n";

export interface BackendErrorIssue {
  message: string;
  path: string;
}

export interface BackendErrorPayload {
  code?: string;
  error?: string;
  issues?: BackendErrorIssue[];
  message?: string;
}

export class BackendApiError extends Error {
  readonly code?: string;
  readonly issues?: BackendErrorIssue[];
  readonly status?: number;

  constructor(message: string, options: { code?: string; issues?: BackendErrorIssue[]; status?: number } = {}) {
    super(message);
    this.name = "BackendApiError";
    this.code = options.code;
    this.issues = options.issues;
    this.status = options.status;
  }
}

export async function createBackendApiError(response: Response, fallback: string) {
  const payload = await readBackendErrorPayload(response);

  if (!payload) {
    return new BackendApiError(getFallbackBackendMessage(response, fallback), { status: response.status });
  }

  return new BackendApiError(
    getUserFacingBackendMessage(payload, response.status, fallback),
    {
      code: payload.code,
      issues: payload.issues,
      status: response.status,
    }
  );
}

export async function getBackendError(response: Response, fallback: string) {
  return (await createBackendApiError(response, fallback)).message;
}

async function readBackendErrorPayload(response: Response): Promise<BackendErrorPayload | null> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    return {
      code: readBackendErrorCode(record.code),
      error: readNonEmptyString(record.error),
      issues: readBackendErrorIssues(record.issues),
      message: readNonEmptyString(record.message),
    };
  } catch {
    // Plain-text and HTML responses may come from a proxy or an upstream
    // service. They are not part of Oddpath's typed API error contract.
    return null;
  }
}

function getUserFacingBackendMessage(
  payload: BackendErrorPayload,
  status: number,
  fallback: string
) {
  if (payload.code === "DATABASE_UNAVAILABLE") {
    return t("errors.databaseUnavailable");
  }

  if (payload.code === "DATABASE_SCHEMA_OUT_OF_DATE") {
    return t("errors.databaseSchemaOutOfDate");
  }

  if (payload.code === "PAYLOAD_TOO_LARGE") {
    return t("errors.payloadTooLarge");
  }

  if (payload.code === "QUOTA_EXCEEDED") {
    return t("errors.quotaExceeded");
  }

  if (payload.code === "MODEL_UNAVAILABLE") {
    return t("errors.modelUnavailable");
  }

  if (payload.code === "REGISTRATION_DISABLED") {
    return t("auth.register.closed");
  }

  if (payload.code === "INVITE_REQUIRED") {
    return t("errors.auth.inviteRequired");
  }

  if (payload.code === "TERMS_VERSION_OUTDATED") {
    return t("errors.auth.termsOutdated");
  }

  if (status >= 500) {
    return t("errors.serverNoDetails");
  }

  return payload.error || payload.message || fallback;
}

function getFallbackBackendMessage(response: Response, fallback: string) {
  if (response.status >= 500) {
    return t("errors.serverNoDetails");
  }

  return fallback;
}

function readBackendErrorCode(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/i.test(value)
    ? value
    : undefined;
}

function readBackendErrorIssues(value: unknown): BackendErrorIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const issues = value.flatMap((issue) => {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) return [];

    const record = issue as Record<string, unknown>;
    const message = readNonEmptyString(record.message);
    const path = typeof record.path === "string" ? record.path : undefined;

    return message !== undefined && path !== undefined
      ? [{ message, path }]
      : [];
  });

  return issues.length > 0 ? issues : undefined;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
