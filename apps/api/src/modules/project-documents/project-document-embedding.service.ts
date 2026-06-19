import { env } from "../../config/env.js";
import {
  isAiUsageLimitError,
  usageService,
  type AiOperationReservation,
  type AiOperationUsageService,
} from "../usage/usage.service.js";
import { DOCUMENT_EMBEDDING_ACTION } from "../usage/usage.types.js";
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
  usage?: AiOperationUsageService;
}

export function createProjectDocumentEmbeddingService({
  enabled,
  provider,
  repository,
  usage = usageService,
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
      let providerWasCalled = false;
      let usageReservation: AiOperationReservation | undefined;

      try {
        usageReservation = await usage.reserveAiOperation({
          action: DOCUMENT_EMBEDDING_ACTION,
          credits: 1,
          model: activeProvider.model,
          provider: activeProvider.id,
        });
        const result = await activeProvider.embed({
          content: chunk.content,
          purpose: "document",
          title: chunk.title,
        });
        providerWasCalled = true;

        await repository.saveChunkEmbedding({
          chunkIndex: chunk.chunkIndex,
          contentHash: chunk.contentHash,
          dimensions: result.dimensions,
          documentId: chunk.documentId,
          model: result.model,
          values: result.values,
        });
        await ignoreUsageFailure(() =>
          usage.completeAiOperation(usageReservation, {
            creditsUsed: 1,
          })
        );
      } catch (error) {
        if (providerWasCalled) {
          await ignoreUsageFailure(() =>
            usage.completeAiOperation(usageReservation, {
              creditsUsed: 1,
            })
          );
        } else {
          await ignoreUsageFailure(() =>
            usage.failAiOperation(usageReservation, {
              model: activeProvider.model,
              provider: activeProvider.id,
            })
          );
        }

        if (isAiUsageLimitError(error)) {
          console.warn("Project document embedding skipped by AI usage guard:", {
            chunkIndex: chunk.chunkIndex,
            documentId: chunk.documentId,
          });

          continue;
        }

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
    usage: usageService,
  });

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown embedding error";
}

async function ignoreUsageFailure(operation: () => Promise<void>) {
  try {
    await operation();
  } catch {
    // Embedding telemetry must not block document indexing fallbacks.
  }
}
