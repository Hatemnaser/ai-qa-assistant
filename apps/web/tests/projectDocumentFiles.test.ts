import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BackendApiError } from "../src/api/backendErrors.ts";
import {
  getProjectDocumentFileError,
  prepareProjectDocumentFiles,
  PROJECT_DOCUMENT_FILE_POLICY,
  uploadProjectDocumentFiles,
} from "../src/features/project-documents/projectDocumentFiles.ts";

describe("project document files", () => {
  it("keeps the supported file contract explicit", () => {
    assert.deepEqual(
      [...PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions].sort(),
      ["css", "csv", "html", "js", "json", "log", "md", "ts", "txt"]
    );
  });

  it("prepares supported project files for import", async () => {
    const file = createFakeFile({
      content: "# Requirements",
      name: "requirements.md",
      size: 14,
      type: "text/markdown",
    });

    const files = await prepareProjectDocumentFiles([file]);

    assert.deepEqual(files, [
      {
        name: "requirements.md",
        content: "# Requirements",
        mimeType: "text/markdown",
        sizeBytes: 14,
      },
    ]);
  });

  it("normalizes code file MIME types from their extensions", async () => {
    const files = await prepareProjectDocumentFiles([
      createFakeFile({
        content: ":root { color-scheme: dark; }",
        name: "theme.css",
        type: "",
      }),
      createFakeFile({
        content: "const enabled: boolean = true;",
        name: "feature.ts",
        type: "video/mp2t",
      }),
    ]);

    assert.equal(files[0]?.mimeType, "text/css");
    assert.equal(files[1]?.mimeType, "text/typescript");
  });

  it("rejects unsupported and oversized project files", () => {
    assert.match(
      getProjectDocumentFileError(
        createFakeFile({
          name: "requirements.pdf",
          type: "application/pdf",
        })
      ),
      /not supported/
    );
    assert.match(
      getProjectDocumentFileError(
        createFakeFile({
          name: "requirements.md",
          size: PROJECT_DOCUMENT_FILE_POLICY.maxFileBytes + 1,
          type: "text/markdown",
        })
      ),
      /too large/
    );
  });

  it("rejects more than four files in one import", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      createFakeFile({
        name: `requirements-${index + 1}.md`,
      })
    );

    await assert.rejects(() => prepareProjectDocumentFiles(files), /up to 4 files/);
  });

  it("uploads authenticated project files and returns only opaque source asset references", async () => {
    const file = createFakeFile({
      content: "const enabled: boolean = true;",
      name: "feature.ts",
      type: "video/mp2t",
    });
    const files = await uploadProjectDocumentFiles("project-1", [file], async (uploadedFile, options) => {
      assert.equal(uploadedFile, file);
      assert.deepEqual(options, {
        declaredMimeType: "text/typescript",
        projectId: "project-1",
        purpose: "PROJECT_DOCUMENT_SOURCE",
      });
      return {
        asset: {
          createdAt: "2026-08-12T12:00:00.000Z",
          declaredMimeType: "text/typescript",
          detectedMimeType: "text/typescript",
          expectedSizeBytes: file.size,
          id: "asset-source-1",
          originalName: file.name,
          projectId: "project-1",
          purpose: "PROJECT_DOCUMENT_SOURCE",
          readyAt: "2026-08-12T12:00:01.000Z",
          sizeBytes: file.size,
          status: "READY",
        },
        checksumSha256: "checksum",
      };
    });

    assert.deepEqual(files, [{ sourceAssetId: "asset-source-1" }]);
    assert.doesNotMatch(JSON.stringify(files), /const enabled|video\/mp2t/);
  });

  it("keeps inline project import as an explicit disabled-storage rollout fallback", async () => {
    const files = await uploadProjectDocumentFiles(
      "project-1",
      [createFakeFile({ content: "Fallback", name: "notes.txt", type: "text/plain" })],
      async () => {
        throw new BackendApiError("Private storage is disabled.", {
          code: "ASSET_STORAGE_DISABLED",
          status: 503,
        });
      }
    );

    assert.deepEqual(files, [{
      content: "Fallback",
      mimeType: "text/plain",
      name: "notes.txt",
      sizeBytes: 8,
    }]);
  });
});

function createFakeFile(
  overrides: {
    content?: string;
    name?: string;
    size?: number;
    type?: string;
  } = {}
) {
  const content = overrides.content ?? "Requirements";

  return {
    name: overrides.name || "requirements.md",
    size: overrides.size ?? content.length,
    type: overrides.type || "text/markdown",
    async text() {
      return content;
    },
  } as File;
}
