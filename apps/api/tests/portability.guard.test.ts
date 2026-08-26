import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import {
  createPortabilityConcurrencyLimit,
  createPortabilityImportsGate,
  createPortabilityRateLimit,
} from "../src/modules/data-portability/portability.guard.ts";

describe("data portability operation guards", () => {
  it("fails closed when production imports are disabled", () => {
    let nextCalls = 0;
    const response = createResponse();

    createPortabilityImportsGate(false)(
      createRequest("user-1", "192.0.2.1"),
      response.value,
      (() => {
        nextCalls += 1;
      }) as NextFunction
    );

    assert.equal(nextCalls, 0);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body?.code, "PORTABILITY_IMPORTS_DISABLED");
  });

  it("rate-limits by both user and IP with a stable Retry-After response", () => {
    const limiter = createPortabilityRateLimit("test", {
      maxAttempts: 2,
      windowMs: 60_000,
    });
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;

    limiter.middleware(createRequest("user-1", "192.0.2.1"), createResponse().value, next);
    limiter.middleware(createRequest("user-1", "192.0.2.2"), createResponse().value, next);
    const blocked = createResponse();
    limiter.middleware(createRequest("user-1", "192.0.2.3"), blocked.value, next);

    assert.equal(nextCalls, 2);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body?.code, "PORTABILITY_RATE_LIMITED");
    assert.match(blocked.headers["Retry-After"] || "", /^\d+$/);
  });

  it("permits only one active portability operation per user", () => {
    const limiter = createPortabilityConcurrencyLimit({
      maxGlobal: 2,
      maxPerUser: 1,
    });
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;
    const first = createResponse();

    limiter.middleware(createRequest("user-1", "192.0.2.1"), first.value, next);
    const blocked = createResponse();
    limiter.middleware(createRequest("user-1", "192.0.2.1"), blocked.value, next);

    assert.equal(nextCalls, 1);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body?.code, "PORTABILITY_BUSY");

    first.emitter.emit("finish");
    limiter.middleware(
      createRequest("user-1", "192.0.2.1"),
      createResponse().value,
      next
    );
    assert.equal(nextCalls, 2);
  });

  it("bounds active work across users and releases exactly once", () => {
    const limiter = createPortabilityConcurrencyLimit({
      maxGlobal: 2,
      maxPerUser: 1,
    });
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;
    const first = createResponse();
    const second = createResponse();

    limiter.middleware(createRequest("user-1", "192.0.2.1"), first.value, next);
    limiter.middleware(createRequest("user-2", "192.0.2.2"), second.value, next);
    const blocked = createResponse();
    limiter.middleware(createRequest("user-3", "192.0.2.3"), blocked.value, next);

    assert.equal(nextCalls, 2);
    assert.equal(blocked.body?.code, "PORTABILITY_BUSY");

    first.emitter.emit("finish");
    first.emitter.emit("close");
    limiter.middleware(
      createRequest("user-3", "192.0.2.3"),
      createResponse().value,
      next
    );
    assert.equal(nextCalls, 3);
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
  const emitter = new EventEmitter();
  const state: {
    body?: Record<string, string>;
    headers: Record<string, string>;
    statusCode?: number;
  } = { headers: {} };
  const value = Object.assign(emitter, {
    json(body: Record<string, string>) {
      state.body = body;
      return value;
    },
    setHeader(name: string, headerValue: string) {
      state.headers[name] = headerValue;
      return value;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return value;
    },
  }) as unknown as Response;

  return {
    get body() {
      return state.body;
    },
    emitter,
    get headers() {
      return state.headers;
    },
    get statusCode() {
      return state.statusCode;
    },
    value,
  };
}
