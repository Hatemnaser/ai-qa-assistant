import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROJECT_DOCUMENT_CHUNKING_POLICY,
  chunkProjectDocument,
  chunkStructuredText,
} from "../src/modules/project-documents/project-document-chunks.ts";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.repository.ts";

const NOW = new Date("2026-06-11T10:00:00.000Z");

describe("project document chunks", () => {
  it("produces stable boundary-aware chunks from structured content", () => {
    const content = [
      "Checkout rules:  ",
      "",
      "- Guest checkout is disabled.",
      "- Card payments require 3DS.",
      "",
      "",
      "",
      "Expected result:",
      "The order is created once.",
    ].join("\r\n");
    const options = {
      maxChars: 70,
      minBoundaryChars: 35,
      overlapChars: 10,
    };

    const firstRun = chunkStructuredText(content, options);
    const secondRun = chunkStructuredText(content, options);

    assert.deepEqual(firstRun, secondRun);
    assert.equal(firstRun.length > 1, true);
    assert.equal(firstRun.every((chunk) => chunk.length <= options.maxChars), true);
    assert.equal(firstRun.some((chunk) => chunk.includes("\r")), false);
    assert.equal(firstRun.some((chunk) => chunk.includes("\n\n\n")), false);
  });

  it("keeps making progress through content without natural boundaries", () => {
    const chunks = chunkStructuredText("x".repeat(2500));

    assert.equal(chunks.length, 3);
    assert.equal(
      chunks.every((chunk) => chunk.length <= PROJECT_DOCUMENT_CHUNKING_POLICY.maxChunkChars),
      true
    );
    assert.equal(chunks.at(-1)?.endsWith("x"), true);
  });

  it("adds stable document metadata to every chunk", () => {
    const chunks = chunkProjectDocument(
      createProjectDocument({
        content: "a".repeat(1400),
        id: "document-a",
        title: "  Checkout   rules  ",
      })
    );

    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map(({ chunkCount, chunkIndex, documentId, title }) => ({
        chunkCount,
        chunkIndex,
        documentId,
        title,
      })),
      [
        {
          chunkCount: 2,
          chunkIndex: 0,
          documentId: "document-a",
          title: "Checkout rules",
        },
        {
          chunkCount: 2,
          chunkIndex: 1,
          documentId: "document-a",
          title: "Checkout rules",
        },
      ]
    );
  });

});

function createProjectDocument(
  overrides: Partial<ProjectDocumentRecord> = {}
): ProjectDocumentRecord {
  return {
    chunkingVersion: "",
    contentHash: "",
    id: "document-1",
    indexError: null,
    indexedAt: null,
    indexStatus: "PENDING",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
    mimeType: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
