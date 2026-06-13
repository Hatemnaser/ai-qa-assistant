import {
  needsProjectDocumentIndex,
  prepareProjectDocumentIndex,
} from "./project-document-index.js";
import {
  projectDocumentEmbeddingService,
  type ProjectDocumentEmbeddingService,
} from "./project-document-embedding.service.js";
import {
  projectDocumentIndexRepository,
  type ProjectDocumentIndexRepository,
} from "./project-document-index.repository.js";
import type { ProjectDocumentRecord } from "./project-documents.repository.js";

export interface ProjectDocumentIndexer {
  ensureDocumentsIndexed(documents: ProjectDocumentRecord[]): Promise<void>;
  indexDocument(document: ProjectDocumentRecord): Promise<void>;
  indexDocuments(documents: ProjectDocumentRecord[]): Promise<void>;
}

export function createProjectDocumentIndexer(
  repository: ProjectDocumentIndexRepository,
  embeddings: ProjectDocumentEmbeddingService = projectDocumentEmbeddingService
): ProjectDocumentIndexer {
  async function indexDocument(document: ProjectDocumentRecord) {
    let index: ReturnType<typeof prepareProjectDocumentIndex>;

    try {
      index = prepareProjectDocumentIndex(document);

      const persisted = await repository.replaceDocumentIndex(index);

      if (!persisted) return;
    } catch (error) {
      const message = getErrorMessage(error);

      try {
        await repository.markDocumentIndexFailed(
          document.id,
          document.updatedAt,
          message
        );
      } catch {
        // The source document remains authoritative and lexical retrieval can still derive chunks.
      }

      console.warn("Project document indexing failed:", {
        documentId: document.id,
        error: message,
      });

      return;
    }

    try {
      await embeddings.embedPreparedIndex(index);
    } catch (error) {
      console.warn("Project document embedding orchestration failed:", {
        documentId: document.id,
        error: getErrorMessage(error),
      });
    }
  }

  async function indexDocuments(documents: ProjectDocumentRecord[]) {
    for (const document of documents) {
      await indexDocument(document);
    }
  }

  async function ensureDocumentsIndexed(documents: ProjectDocumentRecord[]) {
    for (const document of documents) {
      if (needsProjectDocumentIndex(document)) {
        await indexDocument(document);
        continue;
      }

      await embeddings.embedPendingDocumentChunks(document.id);
    }
  }

  return {
    ensureDocumentsIndexed,
    indexDocument,
    indexDocuments,
  };
}

export const projectDocumentIndexer = createProjectDocumentIndexer(
  projectDocumentIndexRepository,
  projectDocumentEmbeddingService
);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown indexing error";
}
