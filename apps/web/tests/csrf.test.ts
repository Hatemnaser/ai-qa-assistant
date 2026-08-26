import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { csrfFetch, resetCsrfTokenForTests } from "../src/api/csrf.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("csrfFetch", () => {
  it("refreshes a stale token once and retries the protected request", async () => {
    const csrfTokens = ["stale-token", "current-token"];
    const mutationTokens: string[] = [];
    let csrfRequests = 0;

    globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/auth/csrf") {
        const csrfToken = csrfTokens[csrfRequests++];
        return jsonResponse({ csrfToken });
      }

      const token = new Headers(init?.headers).get("x-csrf-token") || "";
      mutationTokens.push(token);

      if (mutationTokens.length === 1) {
        return jsonResponse({ code: "CSRF_TOKEN_INVALID" }, 403);
      }

      return jsonResponse({ ok: true });
    };

    const response = await csrfFetch("/api/settings", {
      body: JSON.stringify({ theme: "dark" }),
      method: "PUT",
    });

    assert.equal(response.status, 200);
    assert.equal(csrfRequests, 2);
    assert.deepEqual(mutationTokens, ["stale-token", "current-token"]);
  });

  it("does not retry an unrelated forbidden response", async () => {
    let mutationRequests = 0;

    globalThis.fetch = async (input) => {
      if (String(input) === "/api/auth/csrf") {
        return jsonResponse({ csrfToken: "csrf-token" });
      }

      mutationRequests += 1;
      return jsonResponse({ code: "FORBIDDEN" }, 403);
    };

    const response = await csrfFetch("/api/settings", { method: "PUT" });

    assert.equal(response.status, 403);
    assert.equal(mutationRequests, 1);
  });

  it("retries an invalid CSRF response at most once", async () => {
    let csrfRequests = 0;
    let mutationRequests = 0;

    globalThis.fetch = async (input) => {
      if (String(input) === "/api/auth/csrf") {
        csrfRequests += 1;
        return jsonResponse({ csrfToken: `csrf-token-${csrfRequests}` });
      }

      mutationRequests += 1;
      return jsonResponse({ code: "CSRF_TOKEN_INVALID" }, 403);
    };

    const response = await csrfFetch("/api/settings", { method: "PUT" });

    assert.equal(response.status, 403);
    assert.equal(csrfRequests, 2);
    assert.equal(mutationRequests, 2);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
