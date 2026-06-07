import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getProjectDocumentDownload } from "../src/features/project-documents/projectDocumentDownload.ts";
import type { ProjectDocument } from "../src/features/project-documents/types.ts";

describe("project document downloads", () => {
  it("preserves imported file metadata for downloads", () => {
    const download = getProjectDocumentDownload(
      createDocument({
        metadata: {
          originalName: "requirements.json",
          sizeBytes: 18,
        },
        mimeType: "application/json",
        source: "IMPORTED",
        title: "Stored title",
      })
    );

    assert.deepEqual(download, {
      content: "Project document content",
      fileName: "requirements.json",
      mimeType: "application/json",
    });
  });

  it("downloads created project content as a safe Markdown file", () => {
    const download = getProjectDocumentDownload(
      createDocument({
        mimeType: "text/markdown",
        source: "USER_PROVIDED",
        title: "Checkout: rules",
      })
    );

    assert.deepEqual(download, {
      content: "Project document content",
      fileName: "Checkout_ rules.md",
      mimeType: "text/markdown",
    });
  });

  it("does not duplicate the Markdown extension", () => {
    const download = getProjectDocumentDownload(
      createDocument({
        title: "Checkout rules.md",
      })
    );

    assert.equal(download.fileName, "Checkout rules.md");
  });
});

function createDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
    mimeType: "text/markdown",
    metadata: null,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    ...overrides,
  };
}
