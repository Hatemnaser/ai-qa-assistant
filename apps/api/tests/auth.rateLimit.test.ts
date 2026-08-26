import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, it } from "node:test";

import {
  createAuthRateLimitMiddleware,
  resetAuthRateLimitersForTests,
} from "../src/modules/auth/auth.rateLimit.ts";
import { setSecurityEventLoggerForTests } from "../src/lib/security-events.ts";

afterEach(() => {
  resetAuthRateLimitersForTests();
});

describe("auth rate limiter", () => {
  it("limits one normalized email even when the client IP changes", () => {
    const middleware = createAuthRateLimitMiddleware(2);
    const events: unknown[] = [];
    const restoreLogger = setSecurityEventLoggerForTests((event) => events.push(event));

    try {
      assert.equal(runMiddleware(middleware, "203.0.113.1", " Person@Example.com ").nextCalled, true);
      assert.equal(runMiddleware(middleware, "203.0.113.2", "person@example.com").nextCalled, true);

      const blocked = runMiddleware(middleware, "203.0.113.3", "PERSON@EXAMPLE.COM");

      assert.equal(blocked.nextCalled, false);
      assert.equal(blocked.statusCode, 429);
      assert.equal(blocked.body?.code, "RATE_LIMITED");
      assert.match(blocked.headers.get("retry-after") || "", /^\d+$/);
      assert.equal(events.length, 1);
    } finally {
      restoreLogger();
    }
  });
});

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  ip: string,
  email: string
) {
  let body: Record<string, unknown> | undefined;
  let nextCalled = false;
  let statusCode = 200;
  const headers = new Map<string, string>();
  const response = {
    json(payload: Record<string, unknown>) {
      body = payload;
      return response;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    status(value: number) {
      statusCode = value;
      return response;
    },
  } as unknown as Response;
  const request = {
    baseUrl: "/api/auth",
    body: { email },
    ip,
    method: "POST",
    path: "/login",
    socket: { remoteAddress: ip },
  } as unknown as Request;

  middleware(request, response, () => {
    nextCalled = true;
  });

  return {
    body,
    headers,
    nextCalled,
    statusCode,
  };
}
