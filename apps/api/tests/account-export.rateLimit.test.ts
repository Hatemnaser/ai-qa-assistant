import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import {
  ACCOUNT_EXPORT_RATE_LIMIT_POLICY,
  createAccountExportRateLimit,
} from "../src/modules/data-portability/account-export.rateLimit.ts";

describe("account export rate limiter", () => {
  it("allows three exports per hour and returns a stable safe 429 response", () => {
    assert.deepEqual(ACCOUNT_EXPORT_RATE_LIMIT_POLICY, {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1_000,
    });
    const limiter = createAccountExportRateLimit();
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.middleware(
        createRequest("user-1", "192.0.2.1"),
        createResponse().response,
        next
      );
    }

    const blocked = createResponse();
    limiter.middleware(
      createRequest("user-1", "192.0.2.1"),
      blocked.response,
      next
    );

    assert.equal(nextCalls, 3);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body?.code, "ACCOUNT_EXPORT_RATE_LIMITED");
    assert.equal(
      blocked.body?.error,
      "Too many account export requests. Please try again later."
    );
    assert.equal(blocked.body?.message, blocked.body?.error);
    assert.match(blocked.headers["Retry-After"] || "", /^\d+$/);
    assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
  });

  it("cannot be bypassed by rotating IP addresses for one account", () => {
    const limiter = createAccountExportRateLimit({
      maxAttempts: 2,
      windowMs: 60_000,
    });
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;

    limiter.middleware(
      createRequest("user-1", "192.0.2.1"),
      createResponse().response,
      next
    );
    limiter.middleware(
      createRequest("user-1", "192.0.2.2"),
      createResponse().response,
      next
    );
    const blocked = createResponse();
    limiter.middleware(
      createRequest("user-1", "192.0.2.3"),
      blocked.response,
      next
    );

    assert.equal(nextCalls, 2);
    assert.equal(blocked.statusCode, 429);
  });

  it("cannot be bypassed by rotating accounts from one IP address", () => {
    const limiter = createAccountExportRateLimit({
      maxAttempts: 2,
      windowMs: 60_000,
    });
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;

    limiter.middleware(
      createRequest("user-1", "192.0.2.1"),
      createResponse().response,
      next
    );
    limiter.middleware(
      createRequest("user-2", "192.0.2.1"),
      createResponse().response,
      next
    );
    const blocked = createResponse();
    limiter.middleware(
      createRequest("user-3", "192.0.2.1"),
      blocked.response,
      next
    );

    assert.equal(nextCalls, 2);
    assert.equal(blocked.statusCode, 429);
  });
});

function createRequest(userId: string, ip: string) {
  return {
    authUser: { id: userId },
    ip,
    socket: {},
  } as unknown as Request;
}

function createResponse() {
  const state: {
    body?: Record<string, string>;
    headers: Record<string, string>;
    statusCode?: number;
  } = { headers: {} };
  const response = {
    json(body: Record<string, string>) {
      state.body = body;
      return response;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return response;
    },
  } as unknown as Response;

  return {
    get body() {
      return state.body;
    },
    get headers() {
      return state.headers;
    },
    response,
    get statusCode() {
      return state.statusCode;
    },
  };
}
