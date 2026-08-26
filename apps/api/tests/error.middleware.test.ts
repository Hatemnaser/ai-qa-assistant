import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

import { AppError } from "../src/lib/errors.ts";
import { errorHandler } from "../src/middleware/error.middleware.ts";
import { resolveEmbeddingProvider } from "../src/modules/ai/embeddings/embedding-provider-registry.ts";

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

afterEach(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

describe("error middleware", () => {
  it("maps Prisma P1001 database connection errors to a production-safe response", () => {
    console.error = () => {};

    const response = createMockResponse();
    const request = {
      method: "POST",
      path: "/api/auth/login",
    } as Request;

    errorHandler(
      {
        code: "P1001",
        message: "Can't reach database server at localhost:5432",
      },
      request,
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, {
      code: "DATABASE_UNAVAILABLE",
      error: "Service is temporarily unavailable. Please try again later.",
    });
  });

  it("does not write raw error messages or credentials to server logs", () => {
    const logParts: unknown[] = [];
    console.error = (...parts: unknown[]) => {
      logParts.push(...parts);
    };

    const response = createMockResponse();
    const request = {
      method: "POST",
      path: "/api/chat",
    } as Request;
    response.res.locals = {
      requestId: "123e4567-e89b-42d3-a456-426614174000",
    };

    errorHandler(
      new Error("provider failed with prompt=private and key=secret-key"),
      request,
      response.res,
      failNext
    );

    const logged = JSON.stringify(logParts);

    assert.doesNotMatch(logged, /prompt=private/);
    assert.doesNotMatch(logged, /secret-key/);
    assert.match(logged, /UnknownError|Error/);
    assert.match(logged, /123e4567-e89b-42d3-a456-426614174000/);
  });

  it("logs only sanitized error metadata and a registered route template", () => {
    const logParts: unknown[] = [];
    console.error = (...parts: unknown[]) => {
      logParts.push(...parts);
    };

    const response = createMockResponse();
    const request = {
      method: "GET",
      path: "/api/projects/user-object-id-should-stay-private",
      route: { path: "/projects/:projectId" },
    } as Request;
    const error = new AppError("Internal detail.", 500, "private-code");
    error.name = "PrivateOwnerName";

    errorHandler(error, request, response.res, failNext);

    const logged = JSON.stringify(logParts);

    assert.match(logged, /\/projects\/:projectId/);
    assert.doesNotMatch(logged, /user-object-id-should-stay-private/);
    assert.doesNotMatch(logged, /private-code/);
    assert.doesNotMatch(logged, /PrivateOwnerName/);
    assert.match(logged, /UNKNOWN/);
    assert.equal((response.body as { code: string }).code, "private-code");
  });

  it("uses a generic upload message for oversized request bodies", () => {
    const response = createMockResponse();
    const request = {
      method: "POST",
      path: "/api/chat",
    } as Request;

    errorHandler(
      {
        type: "entity.too.large",
      },
      request,
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.body, {
      code: "PAYLOAD_TOO_LARGE",
      error: "Upload is too large. Please use a smaller file.",
    });
  });

  it("exposes application-owned 4xx messages by default", () => {
    console.warn = () => {};

    const response = createMockResponse();

    errorHandler(
      new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND"),
      createRequest("GET", "/api/projects/missing"),
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      code: "PROJECT_NOT_FOUND",
      error: "Project was not found.",
    });
  });

  it("does not expose application-owned 5xx messages by default", () => {
    console.error = () => {};

    const response = createMockResponse();

    errorHandler(
      new AppError(
        "GEMINI_API_KEY is not configured. Internal key name must stay private.",
        500,
        "MISSING_AI_API_KEY"
      ),
      createRequest("POST", "/api/chat"),
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      code: "MISSING_AI_API_KEY",
      error: "Server error while processing the request.",
    });
  });

  it("does not trust messages attached to non-application 4xx errors", () => {
    console.warn = () => {};

    const response = createMockResponse();
    const untrustedError = Object.assign(new Error("SQL fragment and secret value"), {
      status: 400,
    });

    errorHandler(
      untrustedError,
      createRequest("POST", "/api/projects"),
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      code: "API_ERROR",
      error: "Request could not be processed.",
    });
  });

  it("keeps provider configuration details out of 500 responses", () => {
    console.error = () => {};

    const response = createMockResponse();
    const providerError = captureError(() =>
      resolveEmbeddingProvider("private-provider-configuration")
    );

    errorHandler(
      providerError,
      createRequest("POST", "/api/projects/project-1/documents"),
      response.res,
      failNext
    );

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      code: "UNSUPPORTED_EMBEDDING_PROVIDER",
      error: "Server error while processing the request.",
    });
    assert.doesNotMatch(JSON.stringify(response.body), /private-provider-configuration/);
  });
});

function createRequest(method: string, path: string) {
  return { method, path } as Request;
}

function captureError(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error;
  }

  assert.fail("Expected action to throw.");
}

function createMockResponse() {
  const response = {
    body: undefined as unknown,
    statusCode: 200,
    res: {
      headersSent: false,
      json(payload: unknown) {
        response.body = payload;
        return this;
      },
      status(statusCode: number) {
        response.statusCode = statusCode;
        return this;
      },
    } as Response,
  };

  return response;
}

function failNext(error?: unknown): ReturnType<NextFunction> {
  assert.fail(`next should not be called: ${String(error)}`);
}
