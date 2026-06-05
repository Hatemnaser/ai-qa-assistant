import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createAccountMemory,
  createProjectMemory,
  deleteProjectMemory,
  fetchAccountMemories,
  fetchProjectMemories,
  updateAccountMemory,
} from "../src/features/memory/memoryApi.ts";
import type { Memory } from "../src/features/memory/types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
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

  it("uses project-scoped memory routes", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });

      if (init?.method === "GET") {
        return jsonResponse({
          memories: [createMemoryRecord({ projectId: "project-1", scope: "PROJECT" })],
        });
      }

      if (init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({
        memory: createMemoryRecord({ projectId: "project-1", scope: "PROJECT" }),
      });
    });

    await fetchProjectMemories("project/one");
    await createProjectMemory("project/one", { content: "Checkout memory" });
    await deleteProjectMemory("project/one", "memory/one");

    assert.equal(calls[0]?.input, "/api/projects/project%2Fone/memories");
    assert.equal(calls[0]?.init?.method, "GET");
    assert.equal(calls[1]?.input, "/api/projects/project%2Fone/memories");
    assert.equal(calls[1]?.init?.method, "POST");
    assert.equal(calls[2]?.input, "/api/projects/project%2Fone/memories/memory%2Fone");
    assert.equal(calls[2]?.init?.method, "DELETE");
  });

  it("uses backend memory errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ code: "PROJECT_NOT_FOUND", error: "Project was not found." }, 404));

    await assert.rejects(() => fetchProjectMemories("missing-project"), /Project was not found/);
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
  globalThis.fetch = handler;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
