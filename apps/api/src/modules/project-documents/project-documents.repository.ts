import { prisma } from "../../db/prisma.js";
import type {
  ProjectDocumentInput,
  ProjectDocumentMetadata,
  ProjectDocumentSource,
} from "./project-documents.types.js";

export interface ProjectDocumentRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  mimeType: string | null;
  metadata: unknown | null;
  contentHash: string;
  chunkingVersion: string;
  indexStatus: "PENDING" | "READY" | "FAILED";
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectDocumentInput extends ProjectDocumentInput {
  metadata?: ProjectDocumentMetadata | null;
  projectId: string;
  source?: ProjectDocumentSource;
}

export interface UpdateProjectDocumentInput extends ProjectDocumentInput {
  documentId: string;
  projectId: string;
}

export interface ProjectDocumentsRepository {
  createProjectDocument(input: CreateProjectDocumentInput): Promise<ProjectDocumentRecord>;
  createProjectDocuments(inputs: CreateProjectDocumentInput[]): Promise<ProjectDocumentRecord[]>;
  deleteProjectDocument(projectId: string, documentId: string): Promise<number>;
  findProjectDocument(projectId: string, documentId: string): Promise<ProjectDocumentRecord | null>;
  listProjectDocuments(projectId: string): Promise<ProjectDocumentRecord[]>;
  updateProjectDocument(input: UpdateProjectDocumentInput): Promise<ProjectDocumentRecord | null>;
}

export function createPrismaProjectDocumentsRepository(): ProjectDocumentsRepository {
  return {
    async createProjectDocument(input) {
      return prisma.projectDocument.create({
        data: {
          content: input.content,
          metadata: toJsonMetadata(input.metadata),
          mimeType: input.mimeType || null,
          projectId: input.projectId,
          source: input.source || "USER_PROVIDED",
          title: input.title,
        },
      });
    },

    async createProjectDocuments(inputs) {
      return prisma.$transaction(
        inputs.map((input) =>
          prisma.projectDocument.create({
            data: {
              content: input.content,
              metadata: toJsonMetadata(input.metadata),
              mimeType: input.mimeType || null,
              projectId: input.projectId,
              source: input.source || "USER_PROVIDED",
              title: input.title,
            },
          })
        )
      );
    },

    async deleteProjectDocument(projectId, documentId) {
      const result = await prisma.projectDocument.deleteMany({
        where: {
          id: documentId,
          projectId,
        },
      });

      return result.count;
    },

    async findProjectDocument(projectId, documentId) {
      return prisma.projectDocument.findFirst({
        where: {
          id: documentId,
          projectId,
        },
      });
    },

    async listProjectDocuments(projectId) {
      return prisma.projectDocument.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          projectId,
        },
      });
    },

    async updateProjectDocument(input) {
      const result = await prisma.projectDocument.updateMany({
        data: {
          chunkingVersion: "",
          content: input.content,
          contentHash: "",
          indexError: null,
          indexedAt: null,
          indexStatus: "PENDING",
          mimeType: input.mimeType || null,
          title: input.title,
        },
        where: {
          id: input.documentId,
          projectId: input.projectId,
        },
      });

      if (result.count === 0) return null;

      return prisma.projectDocument.findFirst({
        where: {
          id: input.documentId,
          projectId: input.projectId,
        },
      });
    },
  };
}

function toJsonMetadata(metadata: ProjectDocumentMetadata | null | undefined) {
  if (!metadata) return undefined;

  return {
    ...(metadata.originalName ? { originalName: metadata.originalName } : {}),
    ...(metadata.sizeBytes !== undefined ? { sizeBytes: metadata.sizeBytes } : {}),
  };
}

export const projectDocumentsRepository = createPrismaProjectDocumentsRepository();
