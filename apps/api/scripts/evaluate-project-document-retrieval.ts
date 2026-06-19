import { performance } from "node:perf_hooks";

import { env } from "../src/config/env.js";
import { resolveEmbeddingProvider } from "../src/modules/ai/embeddings/embedding-provider-registry.js";
import type {
  EmbeddingInput,
  EmbeddingProviderAdapter,
  EmbeddingResult,
} from "../src/modules/ai/embeddings/embedding.types.js";
import { createProjectDocumentHybridRetriever } from "../src/modules/project-documents/project-document-hybrid-retrieval.js";
import {
  prepareProjectDocumentIndex,
  type PreparedProjectDocumentIndex,
} from "../src/modules/project-documents/project-document-index.js";
import type {
  ProjectDocumentRetrievalRepository,
  ProjectDocumentSemanticCandidate,
} from "../src/modules/project-documents/project-document-retrieval.repository.js";
import {
  rankProjectDocumentChunksLexically,
  selectProjectDocumentChunksWithinBudget,
} from "../src/modules/project-documents/project-document-retrieval.js";
import type { ProjectDocumentRecord } from "../src/modules/project-documents/project-documents.repository.js";
import type { AiOperationUsageService } from "../src/modules/usage/usage.service.js";

const ALLOW_REAL_AI_EVALS_ENV = "ALLOW_REAL_AI_EVALS";
const PROJECT_ID = "retrieval-eval-project";
const NOW = new Date("2026-06-13T00:00:00.000Z");

interface EvalCase {
  expectedDocumentId: string;
  id: string;
  query: string;
  scenario: string;
}

interface TimedEmbeddingCall {
  chars: number;
  durationMs: number;
  purpose: EmbeddingInput["purpose"];
}

const FIXTURES = [
  createDocument(
    "profile-policy",
    "Profile data policy",
    "A user can update their display name and avatar. Email address changes require identity verification."
  ),
  createDocument(
    "notification-policy",
    "Notification policy",
    "Users can disable optional marketing email alerts while security notifications remain enabled."
  ),
  createDocument(
    "refund-policy",
    "PayPal refund policy",
    "PayPal refunds require an approved payment and must preserve the original transaction reference."
  ),
  createDocument(
    "query-cache",
    "Product query cache",
    "Redis stores frequently requested catalog results so repeated reads do not reach PostgreSQL on every request."
  ),
  createDocument(
    "anonymous-purchase",
    "Anonymous purchase policy",
    "Visitors may complete a purchase without authentication. An email confirmation is required before payment."
  ),
  createDocument(
    "account-protection",
    "سياسة حماية الحساب",
    "يوقف النظام الوصول مؤقتا بعد خمس محاولات دخول غير ناجحة، ثم يسمح للمستخدم باستعادة الوصول عبر البريد الإلكتروني."
  ),
] as const;

const CASES: EvalCase[] = [
  {
    expectedDocumentId: "refund-policy",
    id: "exact-lexical",
    query: "PayPal refund transaction reference",
    scenario: "Exact lexical evidence must not regress.",
  },
  {
    expectedDocumentId: "anonymous-purchase",
    id: "semantic-english",
    query: "Can unauthenticated shoppers place an order?",
    scenario: "English semantic-only wording.",
  },
  {
    expectedDocumentId: "account-protection",
    id: "semantic-arabic",
    query: "ما الإجراء ضد النشاط العدائي المتكرر؟",
    scenario: "Arabic semantic-only wording.",
  },
  {
    expectedDocumentId: "anonymous-purchase",
    id: "cross-language-arabic-english",
    query: "هل يمكن الشراء بدون إنشاء حساب؟",
    scenario: "Arabic query against an English source document.",
  },
  {
    expectedDocumentId: "query-cache",
    id: "semantic-technical",
    query: "How do we avoid hitting the database for the same catalog data repeatedly?",
    scenario: "Technical semantic retrieval.",
  },
  {
    expectedDocumentId: "notification-policy",
    id: "paraphrased-preference",
    query: "May customers silence advertising outreach?",
    scenario: "Product-policy paraphrase.",
  },
];

async function main() {
  assertRealAiEvalAllowed();

  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required for the real-provider retrieval evaluation.");
  }

  console.warn(
    "Running real-provider retrieval evaluation. This calls the embedding provider and may consume provider credits."
  );

  const calls: TimedEmbeddingCall[] = [];
  const capturedEmbeddings = new Map<string, number[]>();
  const provider = createTimedProvider(
    resolveEmbeddingProvider(),
    calls,
    capturedEmbeddings
  );
  const indexedDocuments = FIXTURES.map(toReadyDocument);
  const candidates = await embedDocumentCandidates(provider, indexedDocuments);
  const repository = createFixtureRepository(candidates);
  const retriever = createProjectDocumentHybridRetriever({
    enabled: true,
    provider,
    repository,
    usage: createEvalUsageService(),
  });
  const results = [];

  for (const evaluation of CASES) {
    const lexicalStartedAt = performance.now();
    const lexicalRanking = rankProjectDocumentChunksLexically({
      documents: indexedDocuments,
      query: evaluation.query,
    });
    const lexical = selectProjectDocumentChunksWithinBudget(
      lexicalRanking.chunks
    );
    const lexicalDurationMs = performance.now() - lexicalStartedAt;
    const hybridStartedAt = performance.now();
    const hybrid = await retriever.retrieve({
      documents: indexedDocuments,
      projectId: PROJECT_ID,
      query: evaluation.query,
    });
    const hybridDurationMs = performance.now() - hybridStartedAt;
    const queryVector = capturedEmbeddings.get(
      toEmbeddingKey({
        content: evaluation.query,
        purpose: "query",
      })
    );

    results.push({
      expectedDocumentId: evaluation.expectedDocumentId,
      hybridDurationMs: round(hybridDurationMs),
      hybridHitAt1: hybrid[0]?.documentId === evaluation.expectedDocumentId,
      hybridTopDocuments: uniqueDocumentIds(hybrid),
      id: evaluation.id,
      lexicalDurationMs: round(lexicalDurationMs),
      lexicalHitAt1: lexical[0]?.documentId === evaluation.expectedDocumentId,
      lexicalMatchedQuery: lexicalRanking.matchedQuery,
      lexicalTopDocuments: uniqueDocumentIds(lexical),
      query: evaluation.query,
      semanticSimilarities: queryVector
        ? rankCandidateSimilarities(candidates, queryVector).slice(0, 6)
        : [],
      scenario: evaluation.scenario,
    });
  }

  const relevantCases = results.length;
  const lexicalHits = results.filter((result) => result.lexicalHitAt1).length;
  const hybridHits = results.filter((result) => result.hybridHitAt1).length;
  const exactLexicalPreserved = results.find(
    (result) => result.id === "exact-lexical"
  )?.hybridHitAt1 === true;
  const semanticCases = results.filter((result) => result.id !== "exact-lexical");
  const semanticHits = semanticCases.filter((result) => result.hybridHitAt1).length;
  const passed =
    exactLexicalPreserved &&
    hybridHits >= lexicalHits &&
    semanticHits >= Math.ceil(semanticCases.length * 0.8);
  const queryCalls = calls.filter((call) => call.purpose === "query");
  const documentCalls = calls.filter((call) => call.purpose === "document");

  const report = {
    generatedAt: new Date().toISOString(),
    provider: provider.id,
    model: provider.model,
    dimensions: provider.dimensions,
    fixtureDocuments: indexedDocuments.length,
    evaluationCases: relevantCases,
    passCriteria: {
      exactLexicalPreserved,
      hybridDoesNotRegressOverall: hybridHits >= lexicalHits,
      semanticHitAt1Target: "at least 80%",
    },
    summary: {
      passed,
      lexicalHitAt1: formatRatio(lexicalHits, relevantCases),
      hybridHitAt1: formatRatio(hybridHits, relevantCases),
      semanticHybridHitAt1: formatRatio(semanticHits, semanticCases.length),
    },
    providerCalls: {
      document: summarizeCalls(documentCalls),
      query: summarizeCalls(queryCalls),
      total: summarizeCalls(calls),
      usageNote:
        "The embedding response does not expose billable token metadata here; call count, input characters, and latency are recorded as the cost proxy.",
    },
    results,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

function createTimedProvider(
  provider: EmbeddingProviderAdapter,
  calls: TimedEmbeddingCall[],
  capturedEmbeddings: Map<string, number[]>
): EmbeddingProviderAdapter {
  return {
    ...provider,
    async embed(input): Promise<EmbeddingResult> {
      const startedAt = performance.now();

      try {
        const result = await provider.embed(input);

        capturedEmbeddings.set(toEmbeddingKey(input), result.values);

        return result;
      } finally {
        calls.push({
          chars: input.content.length + (input.title?.length || 0),
          durationMs: performance.now() - startedAt,
          purpose: input.purpose,
        });
      }
    },
  };
}

async function embedDocumentCandidates(
  provider: EmbeddingProviderAdapter,
  documents: ProjectDocumentRecord[]
) {
  const candidates: ProjectDocumentSemanticCandidate[] = [];

  for (const document of documents) {
    const index = prepareProjectDocumentIndex(document);

    for (const chunk of index.chunks) {
      const result = await provider.embed({
        content: chunk.content,
        purpose: "document",
        title: chunk.title,
      });

      candidates.push({
        chunkIndex: chunk.chunkIndex,
        contentHash: chunk.contentHash,
        documentContentHash: index.contentHash,
        documentId: document.id,
        embedding: result.values,
      });
    }
  }

  return candidates;
}

function createFixtureRepository(
  candidates: ProjectDocumentSemanticCandidate[]
): ProjectDocumentRetrievalRepository {
  return {
    async listSemanticCandidates(input) {
      return candidates
        .filter((candidate) => input.documentIds.includes(candidate.documentId))
        .slice(0, input.limit);
    },
  };
}

function toReadyDocument(document: ProjectDocumentRecord) {
  const index = prepareProjectDocumentIndex(document);

  return {
    ...document,
    chunkingVersion: index.chunkingVersion,
    contentHash: index.contentHash,
    indexStatus: "READY" as const,
    indexedAt: NOW,
  };
}

function createDocument(id: string, title: string, content: string): ProjectDocumentRecord {
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
    projectId: PROJECT_ID,
    source: "USER_PROVIDED",
    title,
    updatedAt: NOW,
  };
}

function uniqueDocumentIds(chunks: Array<{ documentId: string }>) {
  return [...new Set(chunks.map((chunk) => chunk.documentId))];
}

function rankCandidateSimilarities(
  candidates: ProjectDocumentSemanticCandidate[],
  queryVector: number[]
) {
  return candidates
    .map((candidate) => ({
      documentId: candidate.documentId,
      similarity: round(cosineSimilarity(queryVector, candidate.embedding)),
    }))
    .sort((first, second) => second.similarity - first.similarity);
}

function cosineSimilarity(first: number[], second: number[]) {
  let dotProduct = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;

  for (let index = 0; index < first.length; index += 1) {
    const firstValue = first[index] || 0;
    const secondValue = second[index] || 0;

    dotProduct += firstValue * secondValue;
    firstMagnitude += firstValue * firstValue;
    secondMagnitude += secondValue * secondValue;
  }

  return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

function toEmbeddingKey(input: EmbeddingInput) {
  return `${input.purpose}:${input.title || ""}:${input.content}`;
}

function summarizeCalls(calls: TimedEmbeddingCall[]) {
  const durations = calls.map((call) => call.durationMs).sort((a, b) => a - b);

  return {
    calls: calls.length,
    inputCharacters: calls.reduce((total, call) => total + call.chars, 0),
    averageLatencyMs: round(average(durations)),
    p95LatencyMs: round(percentile(durations, 0.95)),
  };
}

function average(values: number[]) {
  if (values.length === 0) return 0;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * ratio) - 1)
  );

  return values[index] || 0;
}

function formatRatio(hits: number, total: number) {
  return {
    hits,
    total,
    rate: total === 0 ? 0 : round(hits / total),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function assertRealAiEvalAllowed() {
  if (process.env[ALLOW_REAL_AI_EVALS_ENV] === "true") return;

  throw new Error(
    `Real-provider retrieval evaluation is disabled. This script calls the real embedding provider and may consume provider credits. Set ${ALLOW_REAL_AI_EVALS_ENV}=true only when you intentionally want to run it.`
  );
}

function createEvalUsageService(): AiOperationUsageService {
  return {
    async completeAiOperation() {},
    async failAiOperation() {},
    async reserveAiOperation(input) {
      return {
        action: input.action,
        model: input.model,
        provider: input.provider,
        reserved: input.credits || 1,
      };
    },
  };
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Real-provider retrieval evaluation failed."
  );
  process.exitCode = 1;
});
