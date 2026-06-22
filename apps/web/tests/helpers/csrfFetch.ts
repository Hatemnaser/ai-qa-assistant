import assert from "node:assert/strict";

const CSRF_TOKEN = "test-csrf-token";
const STATE_CHANGING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export function createCsrfAwareFetch(handler: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (String(input) === "/api/auth/csrf") {
      return jsonResponse({
        csrfToken: CSRF_TOKEN,
      });
    }

    const method = (init?.method || "GET").toUpperCase();

    if (STATE_CHANGING_METHODS.has(method)) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-csrf-token"), CSRF_TOKEN);
    }

    return handler(input, init);
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
