import { prisma } from "../../db/prisma.js";
import type { PreparedProjectDocumentIndex } from "./project-document-index.js";

const MAX_INDEX_ERROR_LENGTH = 500;

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
    error: string
  ): Promise<void>;
  markDocumentIndexFailed(
    documentId: string,
    sourceUpdatedAt: Date,
    error: string
  ): Promise<void>;
  replaceDocumentIndex(input: PreparedProjectDocumentIndex): Promise<boolean>;
  saveChunkEmbedding(input: SaveProjectDocumentChunkEmbeddingInput): Promise<void>;
}

export function createPrismaProjectDocumentIndexRepository(): ProjectDocumentIndexRepository {
  return {
    async listEmbeddingCandidates(documentId, model, dimensions) {
      const chunks = await prisma.projectDocumentChunk.findMany({
        include: {
          document: {
            select: {
              title: true,
            },
          },
        },
        orderBy: {
          chunkIndex: "asc",
        },
        where: {
          documentId,
          OR: [
            {
              embeddingStatus: "PENDING",
            },
            {
              embeddingModel: null,
            },
            {
              embeddingModel: {
                not: model,
              },
            },
            {
              embeddingDimensions: null,
            },
            {
              embeddingDimensions: {
                not: dimensions,
              },
            },
          ],
        },
      });

      return chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        documentId: chunk.documentId,
        title: chunk.document.title,
      }));
    },

    async markChunkEmbeddingFailed(
      documentId,
      chunkIndex,
      contentHash,
      model,
      dimensions,
      error
    ) {
      await prisma.projectDocumentChunk.updateMany({
        data: {
          embeddedAt: null,
          embedding: [],
          embeddingDimensions: dimensions,
          embeddingError: error.slice(0, MAX_INDEX_ERROR_LENGTH),
          embeddingModel: model,
          embeddingStatus: "FAILED",
        },
        where: {
          chunkIndex,
          contentHash,
          documentId,
        },
      });
    },

    async markDocumentIndexFailed(documentId, sourceUpdatedAt, error) {
      await prisma.$transaction(async (transaction) => {
        const failed = await transaction.projectDocument.updateMany({
          data: {
            chunkingVersion: "",
            contentHash: "",
            indexError: error.slice(0, MAX_INDEX_ERROR_LENGTH),
            indexedAt: null,
            indexStatus: "FAILED",
          },
          where: {
            id: documentId,
            updatedAt: sourceUpdatedAt,
          },
        });

        if (failed.count === 0) return;

        await transaction.projectDocumentChunk.deleteMany({
          where: {
            documentId,
          },
        });
      });
    },

    async replaceDocumentIndex(input) {
      return prisma.$transaction(async (transaction) => {
        const indexedAt = new Date();
        const updated = await transaction.projectDocument.updateMany({
          data: {
            chunkingVersion: input.chunkingVersion,
            contentHash: input.contentHash,
            indexError: null,
            indexedAt,
            indexStatus: "READY",
          },
          where: {
            id: input.documentId,
            updatedAt: input.sourceUpdatedAt,
          },
        });

        if (updated.count === 0) return false;

        await transaction.projectDocumentChunk.deleteMany({
          where: {
            documentId: input.documentId,
          },
        });

        if (input.chunks.length > 0) {
          await transaction.projectDocumentChunk.createMany({
            data: input.chunks.map((chunk) => ({
              chunkCount: chunk.chunkCount,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              contentHash: chunk.contentHash,
              documentId: input.documentId,
            })),
          });
        }

        return true;
      });
    },

    async saveChunkEmbedding(input) {
      await prisma.projectDocumentChunk.updateMany({
        data: {
          embeddedAt: new Date(),
          embedding: input.values,
          embeddingDimensions: input.dimensions,
          embeddingError: null,
          embeddingModel: input.model,
          embeddingStatus: "READY",
        },
        where: {
          chunkIndex: input.chunkIndex,
          contentHash: input.contentHash,
          documentId: input.documentId,
        },
      });
    },
  };
}

export const projectDocumentIndexRepository =
  createPrismaProjectDocumentIndexRepository();
