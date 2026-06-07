import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  fetchProjectInstruction,
  saveProjectInstruction,
} from "../src/features/project-instructions/projectInstructionsApi.ts";
import type { ProjectInstruction } from "../src/features/project-instructions/types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("project instructions api", () => {
  it("loads project instructions with credentials included", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project%2Fone/instructions");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        instruction: createProjectInstruction(),
      });
    });

    const instruction = await fetchProjectInstruction("project/one");

    assert.equal(instruction?.content, "Use risk-based testing.");
  });

  it("saves and clears the singleton project instructions", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });
      const body = JSON.parse(String(init?.body)) as { content: string };

      return jsonResponse({
        instruction: body.content ? createProjectInstruction({ content: body.content }) : null,
      });
    });

    const saved = await saveProjectInstruction("project/one", "Use exploratory testing.");
    const cleared = await saveProjectInstruction("project/one", "");

    assert.equal(calls[0]?.input, "/api/projects/project%2Fone/instructions");
    assert.equal(calls[0]?.init?.method, "PUT");
    assert.equal(saved?.content, "Use exploratory testing.");
    assert.equal(cleared, null);
  });

  it("uses backend project instruction errors", async () => {
    mockFetch(async () => jsonResponse({ code: "PROJECT_NOT_FOUND", error: "Project was not found." }, 404));

    await assert.rejects(() => fetchProjectInstruction("missing-project"), /Project was not found/);
  });
});

function createProjectInstruction(overrides: Partial<ProjectInstruction> = {}): ProjectInstruction {
  return {
    projectId: "project-1",
    content: "Use risk-based testing.",
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
