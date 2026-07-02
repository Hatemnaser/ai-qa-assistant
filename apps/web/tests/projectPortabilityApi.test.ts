import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  commitProjectImport,
  exportProjectZip,
  previewProjectImport,
} from "../src/features/projects/projectPortabilityApi.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("project portability api", () => {
  it("exports a project ZIP with chats included by default", async () => {
    mockFetch(async (input, init) => {
      assert.equal(
        input,
        "/api/portability/projects/project%2Fone/export?includeChats=true"
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return zipResponse("portable-project");
    });

    const archive = await exportProjectZip("project/one");

    assert.equal(archive.type, "application/zip");
    assert.equal(await archive.text(), "portable-project");
  });

  it("supports excluding chats from a project export", async () => {
    mockFetch(async (input) => {
      assert.equal(
        input,
        "/api/portability/projects/project-1/export?includeChats=false"
      );

      return zipResponse("no-chats");
    });

    await exportProjectZip("project-1", {
      includeChats: false,
    });
  });

  it("previews a ZIP with the raw file body and ZIP content type", async () => {
    const file = createZipFile("preview.zip");

    mockFetch(async (input, init) => {
      assert.equal(input, "/api/portability/projects/import/preview");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.equal(init?.body, file);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/zip");

      return jsonResponse(createPreview());
    });

    const preview = await previewProjectImport(file);

    assert.equal(preview.suggestedProjectName, "Checkout QA (Imported)");
    assert.deepEqual(preview.counts, {
      documents: 2,
      chats: 3,
      messages: 8,
    });
    assert.deepEqual(preview.warnings, ["Attachment files are unavailable."]);
  });

  it("commits the same ZIP with the preview package digest", async () => {
    const file = createZipFile("commit.zip");

    mockFetch(async (input, init) => {
      const headers = new Headers(init?.headers);

      assert.equal(input, "/api/portability/projects/import/commit");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, file);
      assert.equal(headers.get("content-type"), "application/zip");
      assert.equal(headers.get("x-package-digest"), "digest-123");

      return jsonResponse({
        projectId: "imported-project-1",
        projectName: "Checkout QA (Imported)",
        imported: {
          documents: 2,
          chats: 3,
          messages: 8,
        },
        warnings: [],
      });
    });

    const result = await commitProjectImport(file, "digest-123");

    assert.equal(result.projectId, "imported-project-1");
  });
});

function createPreview() {
  return {
    compatible: true,
    formatVersion: "1.0",
    exportType: "project",
    packageDigest: "digest-123",
    suggestedProjectName: "Checkout QA (Imported)",
    sourceProjectName: "Checkout QA",
    counts: {
      documents: 2,
      chats: 3,
      messages: 8,
    },
    warnings: ["Attachment files are unavailable."],
    unsupported: ["notes.txt"],
  };
}

function createZipFile(name: string) {
  return new File(["project-zip"], name, {
    type: "application/zip",
  });
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

function zipResponse(content: string) {
  return new Response(new Blob([content], { type: "application/zip" }), {
    headers: {
      "Content-Type": "application/zip",
    },
  });
}
