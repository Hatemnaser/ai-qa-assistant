import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, it } from "node:test";

import {
  createAccountDeletionRateLimitMiddleware,
  resetAccountDeletionRateLimitersForTests,
} from "../src/modules/account/account.rateLimit.ts";

afterEach(resetAccountDeletionRateLimitersForTests);

describe("account deletion rate limiter", () => {
  it("limits one account even when its IP changes", () => {
    const middleware = createAccountDeletionRateLimitMiddleware(2);

    assert.equal(runMiddleware(middleware, "user-1", "203.0.113.1").nextCalled, true);
    assert.equal(runMiddleware(middleware, "user-1", "203.0.113.2").nextCalled, true);
    const blocked = runMiddleware(middleware, "user-1", "203.0.113.3");

    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body?.code, "RATE_LIMITED");
    assert.match(blocked.headers.get("retry-after") || "", /^\d+$/u);
  });

  it("limits one IP even when account identities rotate", () => {
    const middleware = createAccountDeletionRateLimitMiddleware(2);

    assert.equal(runMiddleware(middleware, "user-1", "203.0.113.10").nextCalled, true);
    assert.equal(runMiddleware(middleware, "user-2", "203.0.113.10").nextCalled, true);
    const blocked = runMiddleware(middleware, "user-3", "203.0.113.10");

    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.nextCalled, false);
  });
});

function runMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  userId: string,
  ipAddress: string
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
    authUser: { id: userId },
    baseUrl: "/api/account",
    ip: ipAddress,
    method: "DELETE",
    path: "/",
    socket: { remoteAddress: ipAddress },
  } as unknown as Request;

  middleware(request, response, () => {
    nextCalled = true;
  });

  return { body, headers, nextCalled, statusCode };
}
