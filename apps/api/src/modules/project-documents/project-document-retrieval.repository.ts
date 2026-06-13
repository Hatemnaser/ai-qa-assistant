import { prisma } from "../../db/prisma.js";

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
