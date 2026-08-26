import { API_BASE_URL } from "../config/api";

const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_TOKEN_ENDPOINT = "/api/auth/csrf";
const STATE_CHANGING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();

  if (!STATE_CHANGING_METHODS.has(method)) {
    return fetch(input, init);
  }

  const token = await getCsrfToken();
  const response = await fetchWithCsrfToken(input, init, token);

  if (!(await isInvalidCsrfResponse(response))) {
    return response;
  }

  invalidateCachedToken(token);
  const refreshedToken = await getCsrfToken();

  return fetchWithCsrfToken(input, init, refreshedToken);
}

export async function getCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  csrfTokenPromise ??= fetch(`${API_BASE_URL}${CSRF_TOKEN_ENDPOINT}`, {
    credentials: "include",
    method: "GET",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error("Could not initialize request protection.");
    }

    const payload = (await response.json()) as { csrfToken?: string };

    if (!payload.csrfToken) {
      throw new Error("CSRF token response was missing token data.");
    }

    csrfToken = payload.csrfToken;
    return csrfToken;
  });

  try {
    return await csrfTokenPromise;
  } finally {
    csrfTokenPromise = null;
  }
}

export function resetCsrfTokenForTests() {
  csrfToken = null;
  csrfTokenPromise = null;
}

function fetchWithCsrfToken(input: RequestInfo | URL, init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER_NAME, token);

  return fetch(input, {
    ...init,
    headers,
  });
}

async function isInvalidCsrfResponse(response: Response) {
  if (response.status !== 403) {
    return false;
  }

  try {
    const payload = (await response.clone().json()) as { code?: string };
    return payload.code === "CSRF_TOKEN_INVALID";
  } catch {
    return false;
  }
}

function invalidateCachedToken(rejectedToken: string) {
  if (csrfToken === rejectedToken) {
    csrfToken = null;
  }
}
