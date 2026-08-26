import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryFixedWindowRateLimiter } from "../src/lib/fixed-window-rate-limiter.ts";

describe("in-memory fixed-window rate limiter", () => {
  it("preserves the fixed window and expires a key at the reset boundary", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxAttempts: 2,
      windowMs: 1_000,
    });

    assert.deepEqual(limiter.consume("user:1", 100), {
      limited: false,
      resetAt: 1_100,
    });
    assert.equal(limiter.consume("user:1", 500).limited, false);
    assert.equal(limiter.consume("user:1", 1_099).limited, true);

    assert.deepEqual(limiter.consume("user:1", 1_100), {
      limited: false,
      resetAt: 2_100,
    });
    assert.equal(limiter.trackedKeyCount, 1);
  });

  it("fails closed at capacity without evicting active abuse history", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxAttempts: 1,
      windowMs: 1_000,
      maxTrackedKeys: 2,
    });

    assert.equal(limiter.consume("ip:1", 100).limited, false);
    assert.equal(limiter.consume("ip:2", 200).limited, false);
    assert.deepEqual(limiter.consume("ip:3", 300), {
      limited: true,
      resetAt: 1_300,
    });
    assert.equal(limiter.trackedKeyCount, 2);
    assert.equal(limiter.consume("ip:1", 400).limited, true);
  });

  it("evicts expired capacity before admitting a new identity", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxAttempts: 1,
      windowMs: 1_000,
      maxTrackedKeys: 2,
    });

    limiter.consume("ip:later", 200);
    limiter.consume("ip:first", 100);

    assert.equal(limiter.consume("ip:new", 1_100).limited, false);
    assert.equal(limiter.trackedKeyCount, 2);
    assert.equal(limiter.consume("ip:later", 1_199).limited, true);
    assert.equal(limiter.consume("ip:after-all-expire", 1_200).limited, false);
    assert.equal(limiter.trackedKeyCount, 2);
  });
});
