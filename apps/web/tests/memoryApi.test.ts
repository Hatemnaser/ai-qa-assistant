import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import { ApiAdapterError } from "../src/api/apiAdapterError.ts";
import {
  createAccountMemory,
  fetchAccountMemories,
  updateAccountMemory,
} from "../src/features/memory/memoryApi.ts";
import type { Memory } from "../src/features/memory/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("memory api", () => {
  it("loads account memories with credentials included", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/memories");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        memories: [createMemoryRecord()],
      });
    });

    const memories = await fetchAccountMemories();

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.scope, "USER");
  });

  it("creates and updates account memories", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });

      return jsonResponse({
        memory: createMemoryRecord({
          content: "Updated QA preference",
        }),
      });
    });

    await createAccountMemory({ content: "QA preference" });
    const memory = await updateAccountMemory("memory/one", { content: "Updated QA preference" });

    assert.equal(calls[0]?.input, "/api/memories");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { content: "QA preference" });
    assert.equal(calls[1]?.input, "/api/memories/memory%2Fone");
    assert.equal(calls[1]?.init?.method, "PUT");
    assert.equal(memory.content, "Updated QA preference");
  });

  it("uses backend memory errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ code: "MEMORY_NOT_FOUND", error: "Memory was not found." }, 404));

    await assert.rejects(() => updateAccountMemory("missing-memory", { content: "Missing" }), /Memory was not found/);
  });

  it("returns stable client error data instead of English adapter fallback copy", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));

    await assert.rejects(
      () => createAccountMemory({ content: "Remember this" }),
      (error: unknown) => {
        assert.ok(error instanceof ApiAdapterError);
        assert.equal(error.code, "INVALID_RESPONSE");
        assert.equal(error.message, "INVALID_RESPONSE");
        return true;
      }
    );
  });
});

function createMemoryRecord(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "memory-1",
    projectId: null,
    scope: "USER",
    content: "Remember concise QA answers.",
    source: "USER_PROVIDED",
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = createCsrfAwareFetch(handler);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
