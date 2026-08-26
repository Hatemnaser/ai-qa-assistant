import type { PreparedProjectDocumentIndex } from "./project-document-index.js";

export type ProjectDocumentIndexFailureMessage = "Document indexing failed.";
export type ProjectDocumentEmbeddingFailureMessage = "Document embedding failed.";

export interface ProjectDocumentEmbeddingCandidate {
  chunkIndex: number;
  content: string;
  contentHash: string;
  documentId: string;
  title: string;
}

export interface SaveProjectDocumentChunkEmbeddingInput {
  chunkIndex: number;
  contentHash: string;
  dimensions: number;
  documentId: string;
  model: string;
  values: number[];
}

export interface ProjectDocumentIndexRepository {
  listEmbeddingCandidates(
    documentId: string,
    model: string,
    dimensions: number
  ): Promise<ProjectDocumentEmbeddingCandidate[]>;
  markChunkEmbeddingFailed(
    documentId: string,
    chunkIndex: number,
    contentHash: string,
    model: string,
    dimensions: number,
    error: ProjectDocumentEmbeddingFailureMessage
  ): Promise<void>;
  markDocumentIndexFailed(
    documentId: string,
    sourceUpdatedAt: Date,
    error: ProjectDocumentIndexFailureMessage
  ): Promise<void>;
  replaceDocumentIndex(input: PreparedProjectDocumentIndex): Promise<boolean>;
  saveChunkEmbedding(input: SaveProjectDocumentChunkEmbeddingInput): Promise<void>;
}
