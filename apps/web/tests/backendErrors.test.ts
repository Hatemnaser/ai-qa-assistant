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

  it("maps infrastructure errors to production-safe user guidance", async () => {
    const message = await getBackendError(
      jsonResponse({
        code: "DATABASE_UNAVAILABLE",
        error: "Database is unavailable.",
      }, 503),
      "Request failed."
    );

    assert.match(message, /temporarily unavailable/i);
    assert.doesNotMatch(message, /Docker|PostgreSQL|localhost|127\.0\.0\.1|npm/i);
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

  it("keeps unknown server error codes while hiding their messages", async () => {
    const error = await createBackendApiError(
      jsonResponse({
        code: "INTERNAL_FAILURE",
        error: "connection=private-db.internal; password=super-secret",
      }, 500),
      "Request failed."
    );

    assert.equal(error.code, "INTERNAL_FAILURE");
    assert.equal(error.status, 500);
    assert.doesNotMatch(error.message, /private-db|super-secret/i);
    assert.match(error.message, /something went wrong/i);
  });

  it("does not trust plain-text or HTML error bodies", async () => {
    const clientError = await createBackendApiError(
      textResponse("validation token=private", 400),
      "Request could not be completed."
    );
    const serverError = await createBackendApiError(
      textResponse("<html>proxy password=secret</html>", 502),
      "Request failed."
    );

    assert.equal(clientError.message, "Request could not be completed.");
    assert.doesNotMatch(clientError.message, /private/);
    assert.doesNotMatch(serverError.message, /proxy|password|secret/i);
    assert.match(serverError.message, /something went wrong/i);
  });

  it("falls back safely for non-object JSON error bodies", async () => {
    const error = await createBackendApiError(
      textResponse("null", 500, "application/json"),
      "Request failed."
    );

    assert.equal(error.status, 500);
    assert.match(error.message, /something went wrong/i);
  });

  it("maps registration gate errors to safe user-facing copy", async () => {
    const inviteError = await createBackendApiError(
      jsonResponse({ code: "INVITE_REQUIRED", error: "internal invite failure" }, 403),
      "Request failed."
    );
    const termsError = await createBackendApiError(
      jsonResponse({ code: "TERMS_VERSION_OUTDATED", error: "internal terms failure" }, 409),
      "Request failed."
    );

    assert.equal(inviteError.code, "INVITE_REQUIRED");
    assert.match(inviteError.message, /private beta invite code/i);
    assert.doesNotMatch(inviteError.message, /internal/i);
    assert.match(termsError.message, /documents changed/i);
    assert.doesNotMatch(termsError.message, /internal/i);
  });

  it("maps empty server failures to production-safe guidance", async () => {
    const error = await createBackendApiError(emptyResponse(500), "Request failed.");

    assert.equal(error.status, 500);
    assert.match(error.message, /something went wrong/i);
    assert.doesNotMatch(error.message, /Docker|PostgreSQL|localhost|127\.0\.0\.1|npm/i);
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

function textResponse(text: string, status: number, contentType = "text/plain") {
  return new Response(text, {
    headers: {
      "Content-Type": contentType,
    },
    status,
  });
}
