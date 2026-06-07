import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canUseRichProjectDocumentPreview,
  getProjectDocumentHighlightedHtml,
  getProjectDocumentLineNumbers,
  PROJECT_DOCUMENT_RICH_PREVIEW_LIMIT,
} from "../src/features/project-documents/projectDocumentPreview.ts";
import {
  getProjectDocumentType,
  getProjectDocumentTypeByFileName,
  PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS,
} from "../src/features/project-documents/projectDocumentTypes.ts";
import type { ProjectDocument } from "../src/features/project-documents/types.ts";

describe("project document previews", () => {
  it("maps imported files to extensible preview definitions", () => {
    assert.equal(getProjectDocumentTypeByFileName("theme.css").highlightLanguage, "css");
    assert.equal(getProjectDocumentTypeByFileName("index.html").highlightLanguage, "xml");
    assert.equal(getProjectDocumentTypeByFileName("requirements.md").previewKind, "markdown");
    assert.ok(PROJECT_DOCUMENT_SUPPORTED_EXTENSIONS.includes("ts"));
  });

  it("keeps user-created documents Markdown-backed", () => {
    const document = createDocument({
      source: "USER_PROVIDED",
      title: "Project notes",
    });

    assert.equal(getProjectDocumentType(document).label, "MD");
  });

  it("highlights code while escaping imported HTML source", () => {
    const document = createDocument({
      content: '<script>alert("unsafe")</script>',
      source: "IMPORTED",
      title: "index.html",
    });
    const highlightedHtml = getProjectDocumentHighlightedHtml(document);

    assert.match(highlightedHtml, /hljs-tag/);
    assert.doesNotMatch(highlightedHtml, /<script>/);
    assert.match(highlightedHtml, /&lt;/);
  });

  it("builds line numbers without one DOM node per line", () => {
    assert.equal(getProjectDocumentLineNumbers("first\nsecond\nthird"), "1\n2\n3");
  });

  it("falls back to plain text for large rich previews", () => {
    const document = createDocument({
      content: "a".repeat(PROJECT_DOCUMENT_RICH_PREVIEW_LIMIT + 1),
      source: "IMPORTED",
      title: "large.js",
    });

    assert.equal(canUseRichProjectDocumentPreview(document), false);
    assert.equal(getProjectDocumentHighlightedHtml(document), "");
    assert.equal(getProjectDocumentLineNumbers(document.content), "");
  });
});

function createDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    title: "Project notes",
    content: "# Project notes",
    source: "USER_PROVIDED",
    mimeType: "text/markdown",
    metadata: null,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    ...overrides,
  };
}
