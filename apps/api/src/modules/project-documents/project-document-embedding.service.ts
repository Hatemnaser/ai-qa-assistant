import { env } from "../../config/env.js";
import { logOperationalEvent } from "../../lib/operational-events.js";
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
  PROJECT_DOCUMENT_EMBEDDING_FAILURE_MESSAGE,
  projectDocumentIndexRepository,
} from "./project-document-index.repository.js";
import type {
  ProjectDocumentEmbeddingCandidate,
  ProjectDocumentIndexRepository,
} from "./project-document-index.types.js";

export interface ProjectDocumentEmbeddingService {
  embedPendingDocumentChunks(documentId: string, userId?: string): Promise<void>;
  embedPreparedIndex(index: PreparedProjectDocumentIndex, userId?: string): Promise<void>;
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
  async function embedPreparedIndex(index: PreparedProjectDocumentIndex, userId?: string) {
    if (!enabled || !provider) return;

    await embedChunks(
      index.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        documentId: chunk.documentId,
        title: chunk.title,
      })),
      provider,
      userId
    );
  }

  async function embedPendingDocumentChunks(documentId: string, userId?: string) {
    if (!enabled || !provider) return;

    try {
      await embedChunks(
        await repository.listEmbeddingCandidates(
          documentId,
          provider.model,
          provider.dimensions
        ),
        provider,
        userId
      );
    } catch {
      logOperationalEvent("warn", {
        event: "project_document_processing",
        operation: "embedding_lookup",
        outcome: "failed",
      });
    }
  }

  async function embedChunks(
    chunks: ProjectDocumentEmbeddingCandidate[],
    activeProvider: EmbeddingProviderAdapter,
    userId?: string
  ) {
    for (const chunk of chunks) {
      let providerAttempted = false;
      let providerWasCalled = false;
      let usageReservation: AiOperationReservation | undefined;

      try {
        usageReservation = await usage.reserveAiOperation({
          action: DOCUMENT_EMBEDDING_ACTION,
          credits: 1,
          model: activeProvider.model,
          provider: activeProvider.id,
          userId,
        });
        await usage.recordAiOperationAttempt(usageReservation);
        providerAttempted = true;
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
              providerAttempted,
              provider: activeProvider.id,
            })
          );
        }

        if (isAiUsageLimitError(error)) {
          logOperationalEvent("warn", {
            event: "project_document_processing",
            operation: "embedding_generation",
            outcome: "usage_guard_skipped",
          });

          continue;
        }

        try {
          await repository.markChunkEmbeddingFailed(
            chunk.documentId,
            chunk.chunkIndex,
            chunk.contentHash,
            activeProvider.model,
            activeProvider.dimensions,
            PROJECT_DOCUMENT_EMBEDDING_FAILURE_MESSAGE
          );
        } catch {
          // A stale or failed embedding never blocks the source document or lexical retrieval.
        }

        logOperationalEvent("warn", {
          event: "project_document_processing",
          operation: "embedding_generation",
          outcome: "failed",
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

async function ignoreUsageFailure(operation: () => Promise<void>) {
  try {
    await operation();
  } catch {
    // Embedding telemetry must not block document indexing fallbacks.
  }
}
