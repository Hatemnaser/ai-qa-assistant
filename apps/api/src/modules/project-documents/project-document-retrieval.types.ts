export interface ProjectDocumentSemanticCandidate {
  chunkIndex: number;
  contentHash: string;
  documentContentHash: string;
  documentId: string;
  embedding: number[];
}

export interface ListProjectDocumentSemanticCandidatesInput {
  chunkingVersion: string;
  dimensions: number;
  documentIds: string[];
  limit: number;
  model: string;
  projectId: string;
}

export interface ProjectDocumentRetrievalRepository {
  listSemanticCandidates(
    input: ListProjectDocumentSemanticCandidatesInput
  ): Promise<ProjectDocumentSemanticCandidate[]>;
}
