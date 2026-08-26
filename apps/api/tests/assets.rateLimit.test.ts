import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

import { createAssetInitiateRateLimit } from "../src/modules/assets/assets.rateLimit.ts";

describe("asset initiation rate limiter", () => {
  it("limits an authenticated user even if request network metadata changes", () => {
    const limiter = createAssetInitiateRateLimit({ maxAttempts: 2, windowMs: 60_000 });
    let nextCalls = 0;
    const next = (() => { nextCalls += 1; }) as NextFunction;

    limiter.middleware(createRequest("user-1", "192.0.2.1"), createResponse().response, next);
    limiter.middleware(createRequest("user-1", "192.0.2.2"), createResponse().response, next);
    const blocked = createResponse();
    limiter.middleware(createRequest("user-1", "192.0.2.3"), blocked.response, next);

    assert.equal(nextCalls, 2);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body?.code, "RATE_LIMITED");
    assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
  });
});

function createRequest(userId: string, ip: string) {
  return { authUser: { id: userId }, ip } as unknown as Request;
}

function createResponse() {
  const state: {
    body?: Record<string, string>;
    headers: Record<string, string>;
    statusCode?: number;
  } = { headers: {} };
  const response = {
    json(body: Record<string, string>) { state.body = body; return response; },
    setHeader(name: string, value: string) { state.headers[name] = value; return response; },
    status(statusCode: number) { state.statusCode = statusCode; return response; },
  } as unknown as Response;

  return {
    response,
    get body() { return state.body; },
    get headers() { return state.headers; },
    get statusCode() { return state.statusCode; },
  };
}
