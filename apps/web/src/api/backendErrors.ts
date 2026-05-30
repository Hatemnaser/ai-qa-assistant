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
    getUserFacingBackendMessage(payload, fallback),
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
    const parsed = JSON.parse(text) as BackendErrorPayload;

    return {
      code: parsed.code,
      error: parsed.error,
      issues: parsed.issues,
      message: parsed.message,
    };
  } catch {
    return {
      error: text,
    };
  }
}

function getUserFacingBackendMessage(payload: BackendErrorPayload, fallback: string) {
  const serverMessage = payload.error || payload.message || fallback;

  if (payload.code === "DATABASE_UNAVAILABLE") {
    return "The API is running, but PostgreSQL is not available. Start Docker/PostgreSQL and try again.";
  }

  if (payload.code === "DATABASE_SCHEMA_OUT_OF_DATE") {
    return "The database schema is out of date. Run npm run db:migrate, then restart the API server.";
  }

  if (payload.code === "PAYLOAD_TOO_LARGE") {
    return "That upload is too large. Try a smaller file.";
  }

  if (payload.code === "QUOTA_EXCEEDED") {
    return "The selected AI model is out of quota. Try another model or wait a bit.";
  }

  if (payload.code === "MODEL_UNAVAILABLE") {
    return "The selected AI model is temporarily unavailable. Try another model or wait a bit.";
  }

  return serverMessage;
}

function getFallbackBackendMessage(response: Response, fallback: string) {
  if (response.status >= 500) {
    return "Could not connect to the backend through the Vite /api proxy. Make sure the API server is running on http://127.0.0.1:5000 and PostgreSQL is available.";
  }

  return fallback;
}
