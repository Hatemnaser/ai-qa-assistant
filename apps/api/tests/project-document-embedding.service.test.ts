import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import {
  setOperationalEventLoggerForTests,
  type OperationalEventRecord,
} from "../src/lib/operational-events.ts";
import type {
  EmbeddingProviderAdapter,
} from "../src/modules/ai/embeddings/embedding.types.ts";
import {
  createProjectDocumentEmbeddingService,
} from "../src/modules/project-documents/project-document-embedding.service.ts";
import type {
  ProjectDocumentIndexRepository,
  SaveProjectDocumentChunkEmbeddingInput,
} from "../src/modules/project-documents/project-document-index.types.ts";
import {
  PROJECT_DOCUMENT_EMBEDDING_FAILURE_MESSAGE,
} from "../src/modules/project-documents/project-document-index.repository.ts";
import type {
  AiOperationCompletionInput,
  AiOperationFailureInput,
  AiOperationReservation,
  AiOperationReservationInput,
  AiOperationUsageService,
} from "../src/modules/usage/usage.service.ts";
import { DOCUMENT_EMBEDDING_ACTION } from "../src/modules/usage/usage.types.ts";

describe("project document embedding service", () => {
  it("stores model-aware embeddings for pending chunks", async () => {
    const repository = createFakeRepository();
    const usage = createFakeOperationUsageService();
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider([0.2, 0.8]),
      repository,
      usage,
    });

    await service.embedPendingDocumentChunks("document-1", "user-1");

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
    assert.equal(usage.reservations[0]?.action, DOCUMENT_EMBEDDING_ACTION);
    assert.equal(usage.reservations[0]?.userId, "user-1");
    assert.equal(usage.completions.length, 1);
  });

  it("records provider failures without throwing into document workflows", async () => {
    const repository = createFakeRepository();
    const usage = createFakeOperationUsageService();
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider(
        [],
        new Error("Provider unavailable; prompt=private-text; token=super-secret")
      ),
      repository,
      usage,
    });
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      await service.embedPendingDocumentChunks("document-1");
    } finally {
      restore();
    }

    assert.deepEqual(repository.savedEmbeddings, []);
    assert.deepEqual(repository.failures, [
      {
        chunkIndex: 0,
        contentHash: "chunk-hash",
        dimensions: 2,
        documentId: "document-1",
        error: PROJECT_DOCUMENT_EMBEDDING_FAILURE_MESSAGE,
        model: "test-embedding-model",
      },
    ]);
    assert.equal(usage.failures.length, 1);
    assert.equal(events[0]?.event, "project_document_processing");
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].operation
        : undefined,
      "embedding_generation"
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /document-1|private-text|super-secret|prompt=|token=/i
    );
  });

  it("reports embedding candidate lookup failures without raw error details", async () => {
    const repository = createFakeRepository();
    repository.listEmbeddingCandidates = async () => {
      throw new Error("database=private; document=document-1; token=super-secret");
    };
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider([0.2, 0.8]),
      repository,
      usage: createFakeOperationUsageService(),
    });
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      await service.embedPendingDocumentChunks("document-1");
    } finally {
      restore();
    }

    assert.equal(events[0]?.event, "project_document_processing");
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].operation
        : undefined,
      "embedding_lookup"
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /document-1|private|super-secret|database=|token=/i
    );
  });

  it("does not call the embedding provider when the global AI operation guard rejects", async () => {
    let providerCalls = 0;
    const repository = createFakeRepository();
    const usage = createFakeOperationUsageService(
      new AppError(
        "AI usage is temporarily limited. Please try again later.",
        429,
        "AI_USAGE_LIMIT_REACHED"
      )
    );
    const service = createProjectDocumentEmbeddingService({
      enabled: true,
      provider: createFakeProvider([0.2, 0.8], undefined, () => {
        providerCalls += 1;
      }),
      repository,
      usage,
    });
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      await service.embedPendingDocumentChunks("document-1");
    } finally {
      restore();
    }

    assert.equal(providerCalls, 0);
    assert.deepEqual(repository.savedEmbeddings, []);
    assert.deepEqual(repository.failures, []);
    assert.equal(usage.reservations.length, 1);
    assert.equal(usage.completions.length, 0);
    assert.equal(usage.failures.length, 0);
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].outcome
        : undefined,
      "usage_guard_skipped"
    );
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
      usage: createFakeOperationUsageService(),
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

interface FakeOperationUsageService extends AiOperationUsageService {
  attempts: AiOperationReservation[];
  completions: Array<{
    completion?: AiOperationCompletionInput;
    reservation?: AiOperationReservation;
  }>;
  failures: Array<{
    failure?: AiOperationFailureInput;
    reservation?: AiOperationReservation;
  }>;
  reservations: AiOperationReservationInput[];
}

function createFakeOperationUsageService(error?: Error): FakeOperationUsageService {
  const usage: FakeOperationUsageService = {
    attempts: [],
    completions: [],
    failures: [],
    reservations: [],

    async completeAiOperation(reservation, completion) {
      usage.completions.push({
        completion,
        reservation,
      });
    },

    async failAiOperation(reservation, failure) {
      if (!reservation) return;

      usage.failures.push({
        failure,
        reservation,
      });
    },

    async recordAiOperationAttempt(reservation) {
      if (reservation && "action" in reservation) {
        usage.attempts.push(reservation as AiOperationReservation);
      }
    },

    async reserveAiOperation(input) {
      usage.reservations.push(input);
      if (error) throw error;

      return {
        action: input.action,
        eventId: `usage-${usage.reservations.length}`,
        model: input.model,
        provider: input.provider,
        reserved: input.credits || 1,
      };
    },
  };

  return usage;
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
