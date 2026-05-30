import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BackendApiError, createBackendApiError, getBackendError } from "../src/api/backendErrors.ts";

describe("backend error helpers", () => {
  it("keeps backend messages for normal application errors", async () => {
    const error = await createBackendApiError(
      jsonResponse({
        code: "SESSION_REQUIRED",
        error: "Authentication is required.",
      }, 401),
      "Request failed."
    );

    assert.ok(error instanceof BackendApiError);
    assert.equal(error.code, "SESSION_REQUIRED");
    assert.equal(error.status, 401);
    assert.equal(error.message, "Authentication is required.");
  });

  it("maps infrastructure errors to clearer local setup guidance", async () => {
    const message = await getBackendError(
      jsonResponse({
        code: "DATABASE_UNAVAILABLE",
        error: "Database is unavailable.",
      }, 503),
      "Request failed."
    );

    assert.match(message, /PostgreSQL is not available/);
    assert.match(message, /Start Docker\/PostgreSQL/);
  });

  it("maps provider availability codes without leaking provider internals", async () => {
    const error = await createBackendApiError(
      jsonResponse({
        code: "MODEL_UNAVAILABLE",
        error: "Gemini service returned UNAVAILABLE.",
      }, 503),
      "Request failed."
    );

    assert.equal(error.code, "MODEL_UNAVAILABLE");
    assert.match(error.message, /temporarily unavailable/);
  });

  it("maps empty proxy failures to local backend setup guidance", async () => {
    const error = await createBackendApiError(emptyResponse(500), "Request failed.");

    assert.equal(error.status, 500);
    assert.match(error.message, /Vite \/api proxy/);
    assert.match(error.message, /127\.0\.0\.1:5000/);
    assert.match(error.message, /PostgreSQL/);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}

function emptyResponse(status = 500) {
  return new Response("", { status });
}
