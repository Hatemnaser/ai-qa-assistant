import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

import { errorHandler } from "../src/middleware/error.middleware.ts";

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
});

describe("error middleware", () => {
  it("maps Prisma P1001 database connection errors to setup guidance", () => {
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
      error: "Database is unavailable. Make sure PostgreSQL is running.",
    });
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
});

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
