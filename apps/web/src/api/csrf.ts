const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

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
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER_NAME, token);

  return fetch(input, {
    ...init,
    headers,
  });
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
