import { env } from "../../config/env.js";
import { resolveEmbeddingProvider } from "../ai/embeddings/embedding-provider-registry.js";
import type { EmbeddingProviderAdapter } from "../ai/embeddings/embedding.types.js";
import type { PreparedProjectDocumentIndex } from "./project-document-index.js";
import {
  projectDocumentIndexRepository,
  type ProjectDocumentEmbeddingCandidate,
  type ProjectDocumentIndexRepository,
} from "./project-document-index.repository.js";

export interface ProjectDocumentEmbeddingService {
  embedPendingDocumentChunks(documentId: string): Promise<void>;
  embedPreparedIndex(index: PreparedProjectDocumentIndex): Promise<void>;
}

export interface ProjectDocumentEmbeddingServiceDependencies {
  enabled: boolean;
  provider?: EmbeddingProviderAdapter;
  repository: ProjectDocumentIndexRepository;
}

export function createProjectDocumentEmbeddingService({
  enabled,
  provider,
  repository,
}: ProjectDocumentEmbeddingServiceDependencies): ProjectDocumentEmbeddingService {
  async function embedPreparedIndex(index: PreparedProjectDocumentIndex) {
    if (!enabled || !provider) return;

    await embedChunks(
      index.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        documentId: chunk.documentId,
        title: chunk.title,
      })),
      provider
    );
  }

  async function embedPendingDocumentChunks(documentId: string) {
    if (!enabled || !provider) return;

    try {
      await embedChunks(
        await repository.listEmbeddingCandidates(
          documentId,
          provider.model,
          provider.dimensions
        ),
        provider
      );
    } catch (error) {
      console.warn("Project document embedding lookup failed:", {
        documentId,
        error: getErrorMessage(error),
      });
    }
  }

  async function embedChunks(
    chunks: ProjectDocumentEmbeddingCandidate[],
    activeProvider: EmbeddingProviderAdapter
  ) {
    for (const chunk of chunks) {
      try {
        const result = await activeProvider.embed({
          content: chunk.content,
          purpose: "document",
          title: chunk.title,
        });

        await repository.saveChunkEmbedding({
          chunkIndex: chunk.chunkIndex,
          contentHash: chunk.contentHash,
          dimensions: result.dimensions,
          documentId: chunk.documentId,
          model: result.model,
          values: result.values,
        });
      } catch (error) {
        const message = getErrorMessage(error);

        try {
          await repository.markChunkEmbeddingFailed(
            chunk.documentId,
            chunk.chunkIndex,
            chunk.contentHash,
            activeProvider.model,
            activeProvider.dimensions,
            message
          );
        } catch {
          // A stale or failed embedding never blocks the source document or lexical retrieval.
        }

        console.warn("Project document embedding failed:", {
          chunkIndex: chunk.chunkIndex,
          documentId: chunk.documentId,
          error: message,
        });
      }
    }
  }

  return {
    embedPendingDocumentChunks,
    embedPreparedIndex,
  };
}

export const projectDocumentEmbeddingService =
  createProjectDocumentEmbeddingService({
    enabled:
      env.projectDocumentEmbeddingsEnabled && Boolean(env.geminiApiKey),
    provider:
      env.projectDocumentEmbeddingsEnabled && env.geminiApiKey
        ? resolveEmbeddingProvider()
        : undefined,
    repository: projectDocumentIndexRepository,
  });

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown embedding error";
}
