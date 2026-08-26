import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROJECT_DOCUMENT_RETRIEVAL_POLICY,
  rankProjectDocumentChunksLexically,
  retrieveProjectDocumentChunks,
} from "../src/modules/project-documents/project-document-retrieval.ts";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.types.ts";

const NOW = new Date("2026-06-11T10:00:00.000Z");

describe("project document retrieval", () => {
  it("retrieves an older relevant document ahead of newer unrelated documents", () => {
    const documents = [
      createProjectDocument("document-a", "Release notes", "The dashboard has a new navigation."),
      createProjectDocument("document-b", "Search notes", "Search supports filters and sorting."),
      createProjectDocument("document-c", "Profile notes", "Profiles support avatar updates."),
      createProjectDocument("document-d", "Notification notes", "Email notifications are optional."),
      createProjectDocument(
        "document-checkout",
        "Checkout requirements",
        "PayPal refunds require an approved payment and preserve the transaction reference."
      ),
    ];

    const chunks = retrieveProjectDocumentChunks({
      documents,
      query: "Create PayPal refund test cases",
    });

    assert.equal(chunks[0]?.documentId, "document-checkout");
    assert.equal(chunks.some((chunk) => chunk.documentId === "document-a"), false);
  });

  it("ranks chunks that cover more query terms first", () => {
    const document = createProjectDocument(
      "document-checkout",
      "Payment rules",
      [
        "Card payments require 3DS verification.",
        "x".repeat(1200),
        "PayPal refund failures must preserve the original transaction reference.",
      ].join("\n\n")
    );

    const chunks = retrieveProjectDocumentChunks({
      documents: [document],
      query: "PayPal refund failures",
    });

    assert.match(chunks[0]?.content || "", /PayPal refund failures/);
  });

  it("uses document titles as a strong relevance signal", () => {
    const chunks = retrieveProjectDocumentChunks({
      documents: [
        createProjectDocument(
          "document-checkout",
          "Checkout tax rules",
          "Regional rates are configured by operations."
        ),
        createProjectDocument(
          "document-profile",
          "Profile rules",
          "The profile page mentions checkout only in its navigation example."
        ),
      ],
      query: "CHECKOUT tax edge cases",
    });

    assert.equal(chunks[0]?.documentId, "document-checkout");
  });

  it("uses Unicode query terms for multilingual project documents", () => {
    const chunks = retrieveProjectDocumentChunks({
      documents: [
        createProjectDocument(
          "document-login",
          "متطلبات تسجيل الدخول",
          "يجب قفل الحساب بعد خمس محاولات فاشلة."
        ),
        createProjectDocument("document-checkout", "Checkout", "Card payments require 3DS."),
      ],
      query: "اختبارات تسجيل الدخول",
    });

    assert.equal(chunks[0]?.documentId, "document-login");
  });

  it("ignores generic question words as lexical evidence", () => {
    const ranking = rankProjectDocumentChunksLexically({
      documents: [
        createProjectDocument(
          "document-profile",
          "Profile settings",
          "A user can update their avatar and may change their display name."
        ),
      ],
      query: "Can this and how may that be?",
    });

    assert.equal(ranking.matchedQuery, false);
    assert.equal(ranking.queryTermCount, 0);
  });

  it("falls back to bounded round-robin retrieval when the query has no match", () => {
    const documents = ["a", "b", "c", "d", "e"].map((id) =>
      createProjectDocument(
        `document-${id}`,
        `Document ${id.toUpperCase()}`,
        id.repeat(1500)
      )
    );

    const chunks = retrieveProjectDocumentChunks({
      documents,
      query: "unmatched vocabulary",
    });

    assert.deepEqual(
      chunks.map((chunk) => chunk.documentId),
      [
        "document-a",
        "document-b",
        "document-c",
        "document-d",
        "document-a",
        "document-b",
      ]
    );
  });

  it("keeps query-aware retrieval inside the prompt budget", () => {
    const documents = Array.from({ length: 6 }, (_, index) =>
      createProjectDocument(
        `document-${index + 1}`,
        `Checkout document ${index + 1}`,
        `checkout ${"payment ".repeat(900)}`
      )
    );

    const chunks = retrieveProjectDocumentChunks({
      documents,
      query: "checkout payment",
    });

    assert.equal(chunks.length, PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxChunks);
    assert.equal(
      chunks.reduce((total, chunk) => total + chunk.content.length, 0) <=
        PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxTotalChars,
      true
    );
    assert.equal(
      new Set(chunks.map((chunk) => chunk.documentId)).size <=
        PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxDocuments,
      true
    );
  });
});

function createProjectDocument(
  id: string,
  title: string,
  content: string
): ProjectDocumentRecord {
  return {
    chunkingVersion: "",
    id,
    contentHash: "",
    indexError: null,
    indexedAt: null,
    indexStatus: "PENDING",
    projectId: "project-1",
    title,
    content,
    source: "USER_PROVIDED",
    sourceAssetId: null,
    mimeType: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
