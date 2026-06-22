import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  fetchProjectMemory,
  saveProjectMemory,
} from "../src/features/project-memory/projectMemoryApi.ts";
import type { ProjectMemory } from "../src/features/project-memory/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("project memory api", () => {
  it("loads saved memory and preserves an empty response", async () => {
    const responses = [
      jsonResponse({ memory: createMemory() }),
      jsonResponse({ memory: null }),
    ];

    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project%2Fone/memory");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return responses.shift() as Response;
    });

    const memory = await fetchProjectMemory("project/one");
    const emptyMemory = await fetchProjectMemory("project/one");

    assert.equal(memory?.content, "## Stack\nTypeScript");
    assert.equal(emptyMemory, null);
  });

  it("saves and clears memory through PUT", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });
      const body = JSON.parse(String(init?.body)) as { content: string };

      return jsonResponse({
        memory: body.content ? createMemory({ content: body.content }) : null,
      });
    });

    const saved = await saveProjectMemory("project/one", "## Decisions\nUse PostgreSQL");
    const cleared = await saveProjectMemory("project/one", "");

    assert.equal(saved?.content, "## Decisions\nUse PostgreSQL");
    assert.equal(cleared, null);
    assert.equal(calls[0]?.input, "/api/projects/project%2Fone/memory");
    assert.equal(calls[0]?.init?.method, "PUT");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      content: "## Decisions\nUse PostgreSQL",
    });
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
      content: "",
    });
  });
});

function createMemory(overrides: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    content: "## Stack\nTypeScript",
    createdAt: "2026-06-14T10:00:00.000Z",
    projectId: "project-1",
    source: "USER_PROVIDED",
    updatedAt: "2026-06-14T10:00:00.000Z",
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
