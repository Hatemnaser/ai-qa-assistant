import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../src/lib/browserStorage";

describe("browser storage", () => {
  it("returns the caller's fallback when localStorage access is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });

    assert.equal(getLocalStorageItem("missing", "fallback"), "fallback");
    assert.equal(setLocalStorageItem("key", "value"), false);
    assert.equal(removeLocalStorageItem("key"), false);
  });

  it("contains read, quota-write, and removal failures", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
        removeItem: () => {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("Storage is full", "QuotaExceededError");
        },
      } as unknown as Storage,
    });

    assert.equal(getLocalStorageItem("missing", null), null);
    assert.equal(setLocalStorageItem("key", "value"), false);
    assert.equal(removeLocalStorageItem("key"), false);
  });
});
