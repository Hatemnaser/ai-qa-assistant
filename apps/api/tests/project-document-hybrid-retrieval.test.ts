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
  PROJECT_DOCUMENT_HYBRID_POLICY,
  createProjectDocumentHybridRetriever,
} from "../src/modules/project-documents/project-document-hybrid-retrieval.ts";
import {
  prepareProjectDocumentIndex,
  PROJECT_DOCUMENT_CHUNKING_VERSION,
} from "../src/modules/project-documents/project-document-index.ts";
import type {
  ListProjectDocumentSemanticCandidatesInput,
  ProjectDocumentRetrievalRepository,
  ProjectDocumentSemanticCandidate,
} from "../src/modules/project-documents/project-document-retrieval.types.ts";
import {
  PROJECT_DOCUMENT_RETRIEVAL_POLICY,
} from "../src/modules/project-documents/project-document-retrieval.ts";
import type {
  ProjectDocumentRecord,
} from "../src/modules/project-documents/project-documents.types.ts";
import type {
  AiOperationCompletionInput,
  AiOperationFailureInput,
  AiOperationReservation,
  AiOperationReservationInput,
  AiOperationUsageService,
} from "../src/modules/usage/usage.service.ts";
import { RAG_QUERY_EMBEDDING_ACTION } from "../src/modules/usage/usage.types.ts";

const NOW = new Date("2026-06-13T10:00:00.000Z");

describe("project document hybrid retrieval", () => {
  it("retrieves a semantic match when the query and document use different words", async () => {
    const unrelated = createReadyDocument(
      "document-unrelated",
      "Release notes",
      "The dashboard navigation was updated."
    );
    const relevant = createReadyDocument(
      "document-coverage",
      "Coverage policy",
      "Automobile coverage is mandatory for financed vehicles."
    );
    const repository = createFakeRepository([
      createCandidate(unrelated, [0, 1]),
      createCandidate(relevant, [1, 0]),
    ]);
    const usage = createFakeOperationUsageService();
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository,
      usage,
    });

    const chunks = await retriever.retrieve({
      documents: [unrelated, relevant],
      projectId: "project-1",
      query: "car insurance rules",
      userId: "user-1",
    });

    assert.equal(chunks[0]?.documentId, "document-coverage");
    assert.equal(usage.reservations[0]?.userId, "user-1");
    assert.deepEqual(repository.requests[0], {
      chunkingVersion: PROJECT_DOCUMENT_CHUNKING_VERSION,
      dimensions: 2,
      documentIds: ["document-unrelated", "document-coverage"],
      limit: PROJECT_DOCUMENT_HYBRID_POLICY.maxSemanticCandidates + 1,
      model: "test-embedding-model",
      projectId: "project-1",
    });
  });

  it("blends lexical and semantic ranks instead of replacing exact matches", async () => {
    const exact = createReadyDocument(
      "document-exact",
      "Checkout policy",
      "Guest checkout requires email verification."
    );
    const semanticOnly = createReadyDocument(
      "document-semantic",
      "Anonymous purchase",
      "Visitors must verify their email before payment."
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository: createFakeRepository([
        createCandidate(exact, [0.95, 0.05]),
        createCandidate(semanticOnly, [1, 0]),
      ]),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [exact, semanticOnly],
      projectId: "project-1",
      query: "guest checkout verification",
    });

    assert.equal(chunks[0]?.documentId, "document-exact");
    assert.equal(
      chunks.some((chunk) => chunk.documentId === "document-semantic"),
      true
    );
  });

  it("does not let weak lexical overlap overpower a strong semantic match", async () => {
    const weakLexical = createReadyDocument(
      "document-profile",
      "Profile settings",
      "Users can update order preferences from their account."
    );
    const semanticMatch = createReadyDocument(
      "document-anonymous-purchase",
      "Anonymous purchase policy",
      "Visitors may buy products without creating an account."
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository: createFakeRepository([
        createCandidate(weakLexical, [0.59, Math.sqrt(1 - 0.59 ** 2)]),
        createCandidate(semanticMatch, [0.8, 0.6]),
      ]),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [weakLexical, semanticMatch],
      projectId: "project-1",
      query: "Can unauthenticated shoppers place an order?",
    });

    assert.equal(chunks[0]?.documentId, "document-anonymous-purchase");
  });

  it("ignores stale semantic candidates and preserves lexical fallback", async () => {
    const checkout = createReadyDocument(
      "document-checkout",
      "Checkout rules",
      "PayPal refunds require the original transaction reference."
    );
    const staleCandidate = {
      ...createCandidate(checkout, [1, 0]),
      contentHash: "stale-chunk-hash",
    };
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository: createFakeRepository([staleCandidate]),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [checkout],
      projectId: "project-1",
      query: "PayPal refund tests",
    });

    assert.equal(chunks[0]?.documentId, "document-checkout");
    assert.match(chunks[0]?.content || "", /PayPal refunds/);
  });

  it("keeps an exact lexical match ahead of a semantic-only candidate when its vector is missing", async () => {
    const exact = createReadyDocument(
      "document-exact",
      "Checkout rules",
      "Guest checkout requires email verification."
    );
    const semanticOnly = createReadyDocument(
      "document-semantic",
      "Anonymous purchase",
      "Visitors must verify their email before payment."
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository: createFakeRepository([
        createCandidate(semanticOnly, [1, 0]),
      ]),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [exact, semanticOnly],
      projectId: "project-1",
      query: "guest checkout verification",
    });

    assert.equal(chunks[0]?.documentId, "document-exact");
  });

  it("falls back lexically when query embedding fails", async () => {
    const checkout = createReadyDocument(
      "document-checkout",
      "Checkout rules",
      "Card payments require 3DS verification."
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider(
        [],
        new Error("Provider unavailable; query=private-text; token=super-secret")
      ),
      repository: createFakeRepository([createCandidate(checkout, [1, 0])]),
      usage: createFakeOperationUsageService(),
    });
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      const chunks = await retriever.retrieve({
        documents: [checkout],
        projectId: "project-1",
        query: "card payment verification",
      });

      assert.equal(chunks[0]?.documentId, "document-checkout");
    } finally {
      restore();
    }

    assert.equal(events[0]?.event, "project_document_processing");
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].operation
        : undefined,
      "semantic_retrieval"
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /project-1|private-text|super-secret|query=|token=/i
    );
  });

  it("falls back lexically without calling the provider when the global AI operation guard rejects", async () => {
    let providerCalls = 0;
    const checkout = createReadyDocument(
      "document-checkout",
      "Checkout rules",
      "Card payments require 3DS verification."
    );
    const usage = createFakeOperationUsageService(
      new AppError(
        "AI usage is temporarily limited. Please try again later.",
        429,
        "AI_USAGE_LIMIT_REACHED"
      )
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0], undefined, () => {
        providerCalls += 1;
      }),
      repository: createFakeRepository([createCandidate(checkout, [1, 0])]),
      usage,
    });
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      const chunks = await retriever.retrieve({
        documents: [checkout],
        projectId: "project-1",
        query: "card payment verification",
      });

      assert.equal(chunks[0]?.documentId, "document-checkout");
    } finally {
      restore();
    }

    assert.equal(providerCalls, 0);
    assert.equal(usage.reservations[0]?.action, RAG_QUERY_EMBEDDING_ACTION);
    assert.equal(usage.completions.length, 0);
    assert.equal(usage.failures.length, 0);
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].outcome
        : undefined,
      "usage_guard_skipped"
    );
  });

  it("does not call the provider or repository while semantic retrieval is disabled", async () => {
    let providerCalls = 0;
    const repository = createFakeRepository([]);
    const document = createReadyDocument(
      "document-checkout",
      "Checkout rules",
      "Card payments require 3DS verification."
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: false,
      provider: createFakeProvider([1, 0], undefined, () => {
        providerCalls += 1;
      }),
      repository,
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [document],
      projectId: "project-1",
      query: "card payment verification",
    });

    assert.equal(chunks[0]?.documentId, "document-checkout");
    assert.equal(providerCalls, 0);
    assert.deepEqual(repository.requests, []);
  });

  it("does not call the provider when the compatible candidate set exceeds the local safety limit", async () => {
    let providerCalls = 0;
    const document = createReadyDocument(
      "document-checkout",
      "Checkout rules",
      "Card payments require 3DS verification."
    );
    const candidate = createCandidate(document, [1, 0]);
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0], undefined, () => {
        providerCalls += 1;
      }),
      repository: createFakeRepository(
        Array.from(
          { length: PROJECT_DOCUMENT_HYBRID_POLICY.maxSemanticCandidates + 1 },
          () => candidate
        )
      ),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents: [document],
      projectId: "project-1",
      query: "card payment verification",
    });

    assert.equal(chunks[0]?.documentId, "document-checkout");
    assert.equal(providerCalls, 0);
  });

  it("keeps hybrid results inside document and prompt budgets", async () => {
    const documents = Array.from({ length: 6 }, (_, index) =>
      createReadyDocument(
        `document-${index + 1}`,
        `Policy ${index + 1}`,
        `Coverage rule ${index + 1}. ${"detail ".repeat(220)}`
      )
    );
    const retriever = createProjectDocumentHybridRetriever({
      enabled: true,
      provider: createFakeProvider([1, 0]),
      repository: createFakeRepository(
        documents.map((document, index) =>
          createCandidate(document, [1, index / 10])
        )
      ),
      usage: createFakeOperationUsageService(),
    });

    const chunks = await retriever.retrieve({
      documents,
      projectId: "project-1",
      query: "insurance requirements",
    });

    assert.equal(
      chunks.length <= PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxChunks,
      true
    );
    assert.equal(
      new Set(chunks.map((chunk) => chunk.documentId)).size <=
        PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxDocuments,
      true
    );
    assert.equal(
      chunks.reduce((total, chunk) => total + chunk.content.length, 0) <=
        PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxTotalChars,
      true
    );
  });
});

interface FakeRepository extends ProjectDocumentRetrievalRepository {
  requests: ListProjectDocumentSemanticCandidatesInput[];
}

function createFakeRepository(
  candidates: ProjectDocumentSemanticCandidate[]
): FakeRepository {
  const requests: ListProjectDocumentSemanticCandidatesInput[] = [];

  return {
    requests,
    async listSemanticCandidates(input) {
      requests.push(input);
      return candidates;
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
      if (!reservation) return;

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

function createReadyDocument(
  id: string,
  title: string,
  content: string
): ProjectDocumentRecord {
  const document = createProjectDocument(id, title, content);
  const index = prepareProjectDocumentIndex(document);

  return {
    ...document,
    chunkingVersion: index.chunkingVersion,
    contentHash: index.contentHash,
    indexStatus: "READY",
    indexedAt: NOW,
  };
}

function createCandidate(
  document: ProjectDocumentRecord,
  embedding: number[]
): ProjectDocumentSemanticCandidate {
  const index = prepareProjectDocumentIndex(document);
  const chunk = index.chunks[0];

  if (!chunk) {
    throw new Error("Expected the test document to produce a chunk.");
  }

  return {
    chunkIndex: chunk.chunkIndex,
    contentHash: chunk.contentHash,
    documentContentHash: index.contentHash,
    documentId: document.id,
    embedding,
  };
}

function createProjectDocument(
  id: string,
  title: string,
  content: string
): ProjectDocumentRecord {
  return {
    chunkingVersion: "",
    content,
    contentHash: "",
    createdAt: NOW,
    id,
    indexError: null,
    indexedAt: null,
    indexStatus: "PENDING",
    metadata: null,
    mimeType: "text/markdown",
    projectId: "project-1",
    source: "USER_PROVIDED",
    sourceAssetId: null,
    title,
    updatedAt: NOW,
  };
}
