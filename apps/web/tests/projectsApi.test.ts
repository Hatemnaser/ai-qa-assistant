import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createProject, deleteProject, fetchProjects, updateProject } from "../src/features/projects/projectsApi.ts";
import type { Project } from "../src/features/projects/types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("projects api", () => {
  it("loads the current user's projects", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        projects: [createProjectRecord()],
      });
    });

    const projects = await fetchProjects();

    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.name, "Checkout QA");
  });

  it("creates projects with credentials included", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        description: "Checkout and payment flows",
        name: "Checkout QA",
      });

      return jsonResponse({
        project: createProjectRecord(),
      });
    });

    const project = await createProject({
      description: "Checkout and payment flows",
      name: "Checkout QA",
    });

    assert.equal(project.id, "project-1");
  });

  it("updates and deletes projects by id", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });

      if (init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({
        project: createProjectRecord({
          description: null,
          name: "Updated QA",
        }),
      });
    });

    const project = await updateProject("project/one", {
      description: null,
      name: "Updated QA",
    });
    await deleteProject("project/one");

    assert.equal(project.name, "Updated QA");
    assert.equal(calls[0]?.input, "/api/projects/project%2Fone");
    assert.equal(calls[0]?.init?.method, "PUT");
    assert.equal(calls[1]?.input, "/api/projects/project%2Fone");
    assert.equal(calls[1]?.init?.method, "DELETE");
  });

  it("uses backend project errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ code: "SESSION_REQUIRED", error: "Authentication is required." }, 401));

    await assert.rejects(() => fetchProjects(), /Authentication is required/);
  });
});

function createProjectRecord(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Checkout QA",
    description: "Checkout and payment flows",
    role: "OWNER",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
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
