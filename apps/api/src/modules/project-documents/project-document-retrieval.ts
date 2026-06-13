import {
  chunkProjectDocument,
  type ProjectDocumentChunk,
} from "./project-document-chunks.js";
import type { ProjectDocumentRecord } from "./project-documents.repository.js";

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const QUERY_STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "could",
  "create",
  "do",
  "does",
  "explain",
  "for",
  "from",
  "generate",
  "give",
  "how",
  "is",
  "make",
  "may",
  "please",
  "review",
  "should",
  "show",
  "that",
  "the",
  "this",
  "with",
  "would",
  "write",
]);

export const PROJECT_DOCUMENT_RETRIEVAL_POLICY = Object.freeze({
  maxChunks: 6,
  maxDocuments: 4,
  maxQueryTerms: 16,
  maxTermFrequency: 3,
  maxTotalChars: 7200,
  minQueryTermChars: 3,
});

export interface ProjectDocumentRetrievalInput {
  documents: ProjectDocumentRecord[];
  query: string;
}

export interface ProjectDocumentRetriever {
  retrieve(input: ProjectDocumentRetrievalInput & { projectId: string }): Promise<ProjectDocumentChunk[]>;
}

export interface LexicalProjectDocumentRanking {
  chunks: ProjectDocumentChunk[];
  matchedQuery: boolean;
  queryTermCount: number;
  rankedChunks: RankedLexicalProjectDocumentChunk[];
}

export interface RankedLexicalProjectDocumentChunk {
  chunk: ProjectDocumentChunk;
  matchedTerms: number;
  score: number;
}

interface ScoredDocument {
  document: ProjectDocumentRecord;
  documentOrder: number;
  matchedTerms: number;
  score: number;
}

interface ScoredChunk {
  chunk: ProjectDocumentChunk;
  documentOrder: number;
  matchedTerms: number;
  score: number;
}

export function retrieveProjectDocumentChunks({
  documents,
  query,
}: ProjectDocumentRetrievalInput): ProjectDocumentChunk[] {
  return selectProjectDocumentChunksWithinBudget(
    rankProjectDocumentChunksLexically({
      documents,
      query,
    }).chunks
  );
}

export function rankProjectDocumentChunksLexically({
  documents,
  query,
}: ProjectDocumentRetrievalInput): LexicalProjectDocumentRanking {
  const queryTerms = tokenizeQuery(query);

  if (queryTerms.length === 0) {
    return {
      chunks: rankFallbackChunks(documents),
      matchedQuery: false,
      queryTermCount: 0,
      rankedChunks: [],
    };
  }

  const rankedDocuments = documents
    .map((document, documentOrder) => scoreDocument(document, documentOrder, queryTerms))
    .filter((document) => document.matchedTerms > 0)
    .sort(compareScoredDocuments)
    .slice(0, PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxDocuments);

  if (rankedDocuments.length === 0) {
    return {
      chunks: rankFallbackChunks(documents),
      matchedQuery: false,
      queryTermCount: queryTerms.length,
      rankedChunks: [],
    };
  }

  const rankedChunks = rankedDocuments
    .flatMap(({ document, documentOrder }) =>
      chunkProjectDocument(document).map((chunk) =>
        scoreChunk(chunk, documentOrder, queryTerms)
      )
    )
    .filter((chunk) => chunk.matchedTerms > 0)
    .sort(compareScoredChunks);

  return {
    chunks: rankedChunks.map(({ chunk }) => chunk),
    matchedQuery: true,
    queryTermCount: queryTerms.length,
    rankedChunks: rankedChunks.map(({ chunk, matchedTerms, score }) => ({
      chunk,
      matchedTerms,
      score,
    })),
  };
}

function rankFallbackChunks(documents: ProjectDocumentRecord[]) {
  const chunkGroups: ProjectDocumentChunk[][] = [];

  for (const document of documents) {
    const chunks = chunkProjectDocument(document);

    if (chunks.length > 0) {
      chunkGroups.push(chunks);
    }

    if (chunkGroups.length >= PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxDocuments) {
      break;
    }
  }

  const orderedChunks: ProjectDocumentChunk[] = [];

  for (let chunkIndex = 0; ; chunkIndex += 1) {
    let foundChunk = false;

    for (const chunks of chunkGroups) {
      const chunk = chunks[chunkIndex];

      if (!chunk) continue;

      foundChunk = true;
      orderedChunks.push(chunk);
    }

    if (!foundChunk) break;
  }

  return orderedChunks;
}

export function selectProjectDocumentChunksWithinBudget(chunks: ProjectDocumentChunk[]) {
  const selectedChunks: ProjectDocumentChunk[] = [];
  const selectedDocumentIds = new Set<string>();
  let totalChars = 0;

  for (const chunk of chunks) {
    if (selectedChunks.length >= PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxChunks) break;
    if (totalChars + chunk.content.length > PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxTotalChars) break;
    if (
      !selectedDocumentIds.has(chunk.documentId) &&
      selectedDocumentIds.size >= PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxDocuments
    ) {
      continue;
    }

    selectedChunks.push(chunk);
    selectedDocumentIds.add(chunk.documentId);
    totalChars += chunk.content.length;
  }

  return selectedChunks;
}

function scoreDocument(
  document: ProjectDocumentRecord,
  documentOrder: number,
  queryTerms: string[]
): ScoredDocument {
  const titleMatches = countTermMatches(document.title, queryTerms, 1);
  const contentMatches = countTermMatches(
    document.content,
    queryTerms,
    PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxTermFrequency
  );

  return {
    document,
    documentOrder,
    matchedTerms: countMatchedTerms(titleMatches, contentMatches),
    score: sumMatches(titleMatches, 8) + sumMatches(contentMatches, 1),
  };
}

function scoreChunk(
  chunk: ProjectDocumentChunk,
  documentOrder: number,
  queryTerms: string[]
): ScoredChunk {
  const titleMatches = countTermMatches(chunk.title, queryTerms, 1);
  const contentMatches = countTermMatches(
    chunk.content,
    queryTerms,
    PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxTermFrequency
  );

  return {
    chunk,
    documentOrder,
    matchedTerms: countMatchedTerms(titleMatches, contentMatches),
    score: sumMatches(titleMatches, 4) + sumMatches(contentMatches, 2),
  };
}

function countTermMatches(text: string, queryTerms: string[], maxFrequency: number) {
  const matches = new Map(queryTerms.map((term) => [term, 0]));

  for (const token of iterateTokens(text)) {
    const count = matches.get(token);

    if (count === undefined || count >= maxFrequency) continue;

    matches.set(token, count + 1);
  }

  return matches;
}

function countMatchedTerms(...matches: Map<string, number>[]) {
  const matchedTerms = new Set<string>();

  for (const matchSet of matches) {
    for (const [term, count] of matchSet) {
      if (count > 0) matchedTerms.add(term);
    }
  }

  return matchedTerms.size;
}

function sumMatches(matches: Map<string, number>, weight: number) {
  let score = 0;

  for (const count of matches.values()) {
    score += count * weight;
  }

  return score;
}

function tokenizeQuery(query: string) {
  return [...new Set(iterateTokens(query))]
    .filter(
      (token) =>
        token.length >= PROJECT_DOCUMENT_RETRIEVAL_POLICY.minQueryTermChars &&
        !QUERY_STOP_WORDS.has(token)
    )
    .slice(0, PROJECT_DOCUMENT_RETRIEVAL_POLICY.maxQueryTerms);
}

function* iterateTokens(text: string) {
  for (const [token] of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    yield token;
  }
}

function compareScoredDocuments(first: ScoredDocument, second: ScoredDocument) {
  return (
    second.matchedTerms - first.matchedTerms ||
    second.score - first.score ||
    first.documentOrder - second.documentOrder
  );
}

function compareScoredChunks(first: ScoredChunk, second: ScoredChunk) {
  return (
    second.matchedTerms - first.matchedTerms ||
    second.score - first.score ||
    first.chunk.chunkIndex - second.chunk.chunkIndex ||
    first.documentOrder - second.documentOrder
  );
}
