import { logOperationalEvent } from "../../lib/operational-events.js";
import {
  needsProjectDocumentIndex,
  prepareProjectDocumentIndex,
} from "./project-document-index.js";
import {
  projectDocumentEmbeddingService,
  type ProjectDocumentEmbeddingService,
} from "./project-document-embedding.service.js";
import {
  PROJECT_DOCUMENT_INDEX_FAILURE_MESSAGE,
  projectDocumentIndexRepository,
} from "./project-document-index.repository.js";
import type { ProjectDocumentIndexRepository } from "./project-document-index.types.js";
import type { ProjectDocumentRecord } from "./project-documents.types.js";

export interface ProjectDocumentIndexer {
  ensureDocumentsIndexed(documents: ProjectDocumentRecord[], userId?: string): Promise<void>;
  indexDocument(document: ProjectDocumentRecord, userId?: string): Promise<void>;
  indexDocuments(documents: ProjectDocumentRecord[], userId?: string): Promise<void>;
}

export function createProjectDocumentIndexer(
  repository: ProjectDocumentIndexRepository,
  embeddings: ProjectDocumentEmbeddingService = projectDocumentEmbeddingService
): ProjectDocumentIndexer {
  async function indexDocument(document: ProjectDocumentRecord, userId?: string) {
    let index: ReturnType<typeof prepareProjectDocumentIndex>;

    try {
      index = prepareProjectDocumentIndex(document);

      const persisted = await repository.replaceDocumentIndex(index);

      if (!persisted) return;
    } catch {
      try {
        await repository.markDocumentIndexFailed(
          document.id,
          document.updatedAt,
          PROJECT_DOCUMENT_INDEX_FAILURE_MESSAGE
        );
      } catch {
        // The source document remains authoritative and lexical retrieval can still derive chunks.
      }

      logOperationalEvent("warn", {
        event: "project_document_processing",
        operation: "index_persistence",
        outcome: "failed",
      });

      return;
    }

    try {
      await embeddings.embedPreparedIndex(index, userId);
    } catch {
      logOperationalEvent("warn", {
        event: "project_document_processing",
        operation: "embedding_orchestration",
        outcome: "failed",
      });
    }
  }

  async function indexDocuments(documents: ProjectDocumentRecord[], userId?: string) {
    for (const document of documents) {
      await indexDocument(document, userId);
    }
  }

  async function ensureDocumentsIndexed(documents: ProjectDocumentRecord[], userId?: string) {
    for (const document of documents) {
      if (needsProjectDocumentIndex(document)) {
        await indexDocument(document, userId);
        continue;
      }

      await embeddings.embedPendingDocumentChunks(document.id, userId);
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
