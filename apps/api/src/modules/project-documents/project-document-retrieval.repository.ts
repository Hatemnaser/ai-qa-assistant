import { prisma } from "../../db/prisma.js";
import type { ProjectDocumentRetrievalRepository } from "./project-document-retrieval.types.js";

export function createPrismaProjectDocumentRetrievalRepository(): ProjectDocumentRetrievalRepository {
  return {
    async listSemanticCandidates(input) {
      if (input.documentIds.length === 0) return [];

      const chunks = await prisma.projectDocumentChunk.findMany({
        include: {
          document: {
            select: {
              contentHash: true,
            },
          },
        },
        orderBy: [
          {
            documentId: "asc",
          },
          {
            chunkIndex: "asc",
          },
        ],
        take: input.limit,
        where: {
          documentId: {
            in: input.documentIds,
          },
          embeddingDimensions: input.dimensions,
          embeddingModel: input.model,
          embeddingStatus: "READY",
          document: {
            chunkingVersion: input.chunkingVersion,
            indexStatus: "READY",
            projectId: input.projectId,
          },
        },
      });

      return chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        contentHash: chunk.contentHash,
        documentContentHash: chunk.document.contentHash,
        documentId: chunk.documentId,
        embedding: chunk.embedding,
      }));
    },
  };
}

export const projectDocumentRetrievalRepository =
  createPrismaProjectDocumentRetrievalRepository();
