import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  EmbeddingProviderAdapter,
} from "../src/modules/ai/embeddings/embedding.types.ts";
import {
  createProjectDocumentEmbeddingService,
} from "../src/modules/project-documents/project-document-embedding.service.ts";
import type {
  ProjectDocumentIndexRepository,
  SaveProjectDocumentChunkEmbeddingInput,
} from "../src/modules/project-documents/project-document-index.repository.ts";

describe("project document embedding service", () => {
  it("stores model-aware embeddings for pending chunks", async () => {
    const repository = createFakeRepository();
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider([0.2, 0.8]),
      repository,
    });

    await service.embedPendingDocumentChunks("document-1");

    assert.deepEqual(repository.savedEmbeddings, [
      {
        chunkIndex: 0,
        contentHash: "chunk-hash",
        dimensions: 2,
        documentId: "document-1",
        model: "test-embedding-model",
        values: [0.2, 0.8],
      },
    ]);
    assert.deepEqual(repository.candidateRequests, [
      {
        dimensions: 2,
        documentId: "document-1",
        model: "test-embedding-model",
      },
    ]);
    assert.deepEqual(repository.failures, []);
  });

  it("records provider failures without throwing into document workflows", async () => {
    const repository = createFakeRepository();
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider([], new Error("Provider unavailable")),
      repository,
    });
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    try {
      await service.embedPendingDocumentChunks("document-1");
    } finally {
      console.warn = originalConsoleWarn;
    }

    assert.deepEqual(repository.savedEmbeddings, []);
    assert.deepEqual(repository.failures, [
      {
        chunkIndex: 0,
        contentHash: "chunk-hash",
        dimensions: 2,
        documentId: "document-1",
        error: "Provider unavailable",
        model: "test-embedding-model",
      },
    ]);
  });

  it("does not call providers while embeddings are disabled", async () => {
    let providerCalls = 0;
    const repository = createFakeRepository();
    const provider = createFakeProvider([0.2, 0.8], undefined, () => {
      providerCalls += 1;
    });
    const service = createProjectDocumentEmbeddingService({
      enabled: false,
      provider,
      repository,
    });

    await service.embedPendingDocumentChunks("document-1");

    assert.equal(providerCalls, 0);
    assert.deepEqual(repository.savedEmbeddings, []);
  });
});

interface FakeRepository extends ProjectDocumentIndexRepository {
  candidateRequests: Array<{
    dimensions: number;
    documentId: string;
    model: string;
  }>;
  failures: Array<{
    chunkIndex: number;
    contentHash: string;
    dimensions: number;
    documentId: string;
    error: string;
    model: string;
  }>;
  savedEmbeddings: SaveProjectDocumentChunkEmbeddingInput[];
}

function createFakeRepository(): FakeRepository {
  const candidateRequests: FakeRepository["candidateRequests"] = [];
  const failures: FakeRepository["failures"] = [];
  const savedEmbeddings: SaveProjectDocumentChunkEmbeddingInput[] = [];

  return {
    candidateRequests,
    failures,
    savedEmbeddings,
    async listEmbeddingCandidates(documentId, model, dimensions) {
      candidateRequests.push({
        dimensions,
        documentId,
        model,
      });

      return [
        {
          chunkIndex: 0,
          content: "Guest checkout is disabled.",
          contentHash: "chunk-hash",
          documentId: "document-1",
          title: "Checkout rules",
        },
      ];
    },
    async markChunkEmbeddingFailed(
      documentId,
      chunkIndex,
      contentHash,
      model,
      dimensions,
      error
    ) {
      failures.push({
        chunkIndex,
        contentHash,
        dimensions,
        documentId,
        error,
        model,
      });
    },
    async markDocumentIndexFailed() {},
    async replaceDocumentIndex() {
      return true;
    },
    async saveChunkEmbedding(input) {
      savedEmbeddings.push(input);
    },
  };
}

function createFakeProvider(
  values: number[],
  error?: Error,
  onCall?: () => void
): EmbeddingProviderAdapter {
  return {
    dimensions: values.length || 2,
    id: "gemini",
    model: "test-embedding-model",
    async embed() {
      onCall?.();
      if (error) throw error;

      return {
        dimensions: values.length,
        model: "test-embedding-model",
        provider: "gemini",
        values,
      };
    },
  };
}
