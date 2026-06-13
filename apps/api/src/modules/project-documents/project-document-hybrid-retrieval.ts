import { env } from "../../config/env.js";
import { resolveEmbeddingProvider } from "../ai/embeddings/embedding-provider-registry.js";
import type { EmbeddingProviderAdapter } from "../ai/embeddings/embedding.types.js";
import type { ProjectDocumentChunk } from "./project-document-chunks.js";
import {
  prepareProjectDocumentIndex,
  PROJECT_DOCUMENT_CHUNKING_VERSION,
} from "./project-document-index.js";
import {
  projectDocumentRetrievalRepository,
  type ProjectDocumentRetrievalRepository,
  type ProjectDocumentSemanticCandidate,
} from "./project-document-retrieval.repository.js";
import {
  rankProjectDocumentChunksLexically,
  retrieveProjectDocumentChunks,
  selectProjectDocumentChunksWithinBudget,
  type ProjectDocumentRetrievalInput,
  type ProjectDocumentRetriever,
} from "./project-document-retrieval.js";

export const PROJECT_DOCUMENT_HYBRID_POLICY = Object.freeze({
  lexicalWeight: 0.55,
  maxSemanticCandidates: 1000,
  minSemanticSimilarity: 0.6,
  semanticWeight: 0.45,
});

export interface ProjectDocumentHybridRetrieverDependencies {
  enabled: boolean;
  provider?: EmbeddingProviderAdapter;
  repository: ProjectDocumentRetrievalRepository;
}

interface CurrentSemanticChunk {
  chunk: ProjectDocumentChunk;
  documentOrder: number;
  embedding: number[];
}

interface RankedSemanticChunk {
  chunk: ProjectDocumentChunk;
  documentOrder: number;
  similarity: number;
}

interface FusedChunk {
  chunk: ProjectDocumentChunk;
  documentOrder: number;
  lexicalConfidence?: number;
  lexicalRank?: number;
  score: number;
  similarity?: number;
}

export function createProjectDocumentHybridRetriever({
  enabled,
  provider,
  repository,
}: ProjectDocumentHybridRetrieverDependencies): ProjectDocumentRetriever {
  async function retrieve(
    input: ProjectDocumentRetrievalInput & { projectId: string }
  ): Promise<ProjectDocumentChunk[]> {
    const lexicalFallback = retrieveProjectDocumentChunks(input);

    if (
      !enabled ||
      !provider ||
      input.documents.length === 0 ||
      !input.query.trim()
    ) {
      return lexicalFallback;
    }

    try {
      const candidates = await repository.listSemanticCandidates({
        chunkingVersion: PROJECT_DOCUMENT_CHUNKING_VERSION,
        dimensions: provider.dimensions,
        documentIds: input.documents.map((document) => document.id),
        limit: PROJECT_DOCUMENT_HYBRID_POLICY.maxSemanticCandidates + 1,
        model: provider.model,
        projectId: input.projectId,
      });
      if (
        candidates.length === 0 ||
        candidates.length > PROJECT_DOCUMENT_HYBRID_POLICY.maxSemanticCandidates
      ) {
        return lexicalFallback;
      }

      const currentCandidates = listCurrentSemanticChunks(
        input,
        candidates,
        provider.dimensions
      );

      if (currentCandidates.length === 0) return lexicalFallback;

      const queryEmbedding = await provider.embed({
        content: input.query,
        purpose: "query",
      });

      if (
        queryEmbedding.model !== provider.model ||
        queryEmbedding.dimensions !== provider.dimensions ||
        !isValidVector(queryEmbedding.values, provider.dimensions)
      ) {
        return lexicalFallback;
      }
      const semanticChunks = rankSemanticChunks(
        currentCandidates,
        queryEmbedding.values
      );

      if (semanticChunks.length === 0) return lexicalFallback;

      return selectProjectDocumentChunksWithinBudget(
        fuseSemanticAndLexicalRanks(input, semanticChunks)
      );
    } catch (error) {
      console.warn("Project document semantic retrieval failed:", {
        error: getErrorMessage(error),
        projectId: input.projectId,
      });

      return lexicalFallback;
    }
  }

  return {
    retrieve,
  };
}

function listCurrentSemanticChunks(
  input: ProjectDocumentRetrievalInput,
  candidates: ProjectDocumentSemanticCandidate[],
  dimensions: number
) {
  const documentOrder = new Map(
    input.documents.map((document, index) => [document.id, index])
  );
  const currentIndexes = new Map(
    input.documents.flatMap((document) => {
      if (
        document.indexStatus !== "READY" ||
        document.chunkingVersion !== PROJECT_DOCUMENT_CHUNKING_VERSION
      ) {
        return [];
      }

      try {
        const index = prepareProjectDocumentIndex(document);

        if (index.contentHash !== document.contentHash) return [];

        return [[document.id, index] as const];
      } catch {
        return [];
      }
    })
  );
  const current: CurrentSemanticChunk[] = [];

  for (const candidate of candidates) {
    const index = currentIndexes.get(candidate.documentId);
    const order = documentOrder.get(candidate.documentId);
    const currentChunk = index?.chunks[candidate.chunkIndex];

    if (
      !index ||
      order === undefined ||
      candidate.documentContentHash !== index.contentHash ||
      !currentChunk ||
      currentChunk.contentHash !== candidate.contentHash ||
      !isValidVector(candidate.embedding, dimensions)
    ) {
      continue;
    }

    current.push({
      chunk: currentChunk,
      documentOrder: order,
      embedding: candidate.embedding,
    });
  }

  return current;
}

function rankSemanticChunks(
  candidates: CurrentSemanticChunk[],
  queryVector: number[]
) {
  return candidates
    .map((candidate): RankedSemanticChunk | undefined => {
      const similarity = cosineSimilarity(queryVector, candidate.embedding);

      if (
        !Number.isFinite(similarity) ||
        similarity < PROJECT_DOCUMENT_HYBRID_POLICY.minSemanticSimilarity
      ) {
        return undefined;
      }

      return {
        chunk: candidate.chunk,
        documentOrder: candidate.documentOrder,
        similarity,
      };
    })
    .filter((candidate): candidate is RankedSemanticChunk => Boolean(candidate))
    .sort(
      (first, second) =>
        second.similarity - first.similarity ||
        first.documentOrder - second.documentOrder ||
        first.chunk.chunkIndex - second.chunk.chunkIndex
    );
}

function fuseSemanticAndLexicalRanks(
  input: ProjectDocumentRetrievalInput,
  semanticChunks: RankedSemanticChunk[]
) {
  const lexicalRanking = rankProjectDocumentChunksLexically(input);
  const lexicalChunks = lexicalRanking.matchedQuery
    ? lexicalRanking.rankedChunks
    : [];
  const fused = new Map<string, FusedChunk>();
  const documentOrder = new Map(
    input.documents.map((document, index) => [document.id, index])
  );

  semanticChunks.forEach((item) => {
    fused.set(toChunkKey(item.chunk), {
      chunk: item.chunk,
      documentOrder: item.documentOrder,
      score:
        PROJECT_DOCUMENT_HYBRID_POLICY.semanticWeight *
        normalizeSemanticSimilarity(item.similarity),
      similarity: item.similarity,
    });
  });

  lexicalChunks.forEach((rankedChunk, index) => {
    const rank = index + 1;
    const chunk = rankedChunk.chunk;
    const key = toChunkKey(chunk);
    const existing = fused.get(key);
    const lexicalConfidence = normalizeLexicalConfidence(
      rankedChunk.matchedTerms,
      lexicalRanking.queryTermCount
    );
    const lexicalScore =
      PROJECT_DOCUMENT_HYBRID_POLICY.lexicalWeight * lexicalConfidence;

    fused.set(key, {
      chunk,
      documentOrder: documentOrder.get(chunk.documentId) ?? Number.MAX_SAFE_INTEGER,
      lexicalConfidence,
      lexicalRank: rank,
      score: (existing?.score || 0) + lexicalScore,
      similarity: existing?.similarity,
    });
  });

  return [...fused.values()]
    .sort(compareFusedChunks)
    .map(({ chunk }) => chunk);
}

function compareFusedChunks(first: FusedChunk, second: FusedChunk) {
  return (
    second.score - first.score ||
    (second.similarity ?? -1) - (first.similarity ?? -1) ||
    (second.lexicalConfidence ?? -1) - (first.lexicalConfidence ?? -1) ||
    (first.lexicalRank ?? Number.MAX_SAFE_INTEGER) -
      (second.lexicalRank ?? Number.MAX_SAFE_INTEGER) ||
    first.documentOrder - second.documentOrder ||
    first.chunk.chunkIndex - second.chunk.chunkIndex
  );
}

function normalizeSemanticSimilarity(similarity: number) {
  const floor = PROJECT_DOCUMENT_HYBRID_POLICY.minSemanticSimilarity;

  return Math.min(1, Math.max(0, (similarity - floor) / (1 - floor)));
}

function normalizeLexicalConfidence(matchedTerms: number, queryTermCount: number) {
  if (queryTermCount < 1) return 0;

  const coverage = Math.min(1, matchedTerms / queryTermCount);

  return coverage >= 0.6 ? coverage : coverage * 0.5;
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

  if (firstMagnitude === 0 || secondMagnitude === 0) return Number.NaN;

  return dotProduct / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

function isValidVector(values: number[], dimensions: number) {
  return (
    values.length === dimensions &&
    values.length > 0 &&
    values.every((value) => Number.isFinite(value))
  );
}

function toChunkKey(chunk: ProjectDocumentChunk) {
  return `${chunk.documentId}:${chunk.chunkIndex}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown semantic retrieval error";
}

export const projectDocumentRetriever = createProjectDocumentHybridRetriever({
  enabled:
    env.projectDocumentEmbeddingsEnabled && Boolean(env.geminiApiKey),
  provider:
    env.projectDocumentEmbeddingsEnabled && env.geminiApiKey
      ? resolveEmbeddingProvider()
      : undefined,
  repository: projectDocumentRetrievalRepository,
});
