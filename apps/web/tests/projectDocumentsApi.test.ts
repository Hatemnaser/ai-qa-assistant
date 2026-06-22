import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  createProjectDocument,
  deleteProjectDocument,
  fetchProjectDocuments,
  importProjectDocuments,
  updateProjectDocument,
} from "../src/features/project-documents/projectDocumentsApi.ts";
import type { ProjectDocument } from "../src/features/project-documents/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("project documents api", () => {
  it("loads project documents with credentials included", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project%2Fone/documents");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        documents: [createProjectDocumentRecord()],
      });
    });

    const documents = await fetchProjectDocuments("project/one");

    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.title, "Checkout rules");
  });

  it("creates, updates, and deletes project documents", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    mockFetch(async (input, init) => {
      calls.push({ input, init });

      if (init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({
        document: createProjectDocumentRecord({
          title: "Updated rules",
        }),
      });
    });

    await createProjectDocument("project/one", {
      title: "Checkout rules",
      content: "Guest checkout is disabled.",
    });
    const document = await updateProjectDocument("project/one", "document/one", {
      title: "Updated rules",
      content: "Updated content.",
    });
    await deleteProjectDocument("project/one", "document/one");

    assert.equal(calls[0]?.input, "/api/projects/project%2Fone/documents");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      title: "Checkout rules",
      content: "Guest checkout is disabled.",
    });
    assert.equal(calls[1]?.input, "/api/projects/project%2Fone/documents/document%2Fone");
    assert.equal(calls[1]?.init?.method, "PUT");
    assert.equal(calls[2]?.input, "/api/projects/project%2Fone/documents/document%2Fone");
    assert.equal(calls[2]?.init?.method, "DELETE");
    assert.equal(document.title, "Updated rules");
  });

  it("imports project files as a batch", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/projects/project%2Fone/documents/import");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        files: [
          {
            name: "requirements.md",
            content: "# Requirements",
            mimeType: "text/markdown",
            sizeBytes: 14,
          },
        ],
      });

      return jsonResponse({
        documents: [
          createProjectDocumentRecord({
            source: "IMPORTED",
            title: "requirements.md",
          }),
        ],
      });
    });

    const documents = await importProjectDocuments("project/one", [
      {
        name: "requirements.md",
        content: "# Requirements",
        mimeType: "text/markdown",
        sizeBytes: 14,
      },
    ]);

    assert.equal(documents[0]?.source, "IMPORTED");
  });

  it("uses backend project document errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ code: "PROJECT_NOT_FOUND", error: "Project was not found." }, 404));

    await assert.rejects(() => fetchProjectDocuments("missing-project"), /Project was not found/);
  });
});

function createProjectDocumentRecord(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Checkout rules",
    content: "Guest checkout is disabled.",
    source: "USER_PROVIDED",
    mimeType: null,
    metadata: null,
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
