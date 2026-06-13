import { AppError } from "../../lib/errors.js";
import {
  projectDocumentsRepository,
  type ProjectDocumentRecord,
  type ProjectDocumentsRepository,
} from "./project-documents.repository.js";
import {
  projectDocumentIndexer,
  type ProjectDocumentIndexer,
} from "./project-document-index.service.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import type {
  ProjectDocumentDto,
  ProjectDocumentImportInput,
  ProjectDocumentInput,
  ProjectDocumentMetadata,
} from "./project-documents.types.js";

export interface ProjectDocumentsServiceDependencies {
  indexer: ProjectDocumentIndexer;
  projectAccess: ProjectAccessService;
  repository: ProjectDocumentsRepository;
}

export function createProjectDocumentsService({
  indexer,
  projectAccess,
  repository,
}: ProjectDocumentsServiceDependencies) {
  async function listProjectDocuments(userId: string, projectId: string): Promise<ProjectDocumentDto[]> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const documents = await repository.listProjectDocuments(projectId);

    await indexer.ensureDocumentsIndexed(documents);

    return documents.map(toProjectDocumentDto);
  }

  async function createProjectDocument(
    userId: string,
    projectId: string,
    input: ProjectDocumentInput
  ): Promise<ProjectDocumentDto> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const document = await repository.createProjectDocument({
      content: input.content,
      mimeType: input.mimeType || null,
      projectId,
      title: input.title,
    });

    await indexer.indexDocument(document);

    return toProjectDocumentDto(document);
  }

  async function importProjectDocuments(
    userId: string,
    projectId: string,
    input: ProjectDocumentImportInput
  ): Promise<ProjectDocumentDto[]> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const documents = await repository.createProjectDocuments(
      input.files.map((file) => ({
        content: file.content,
        metadata: {
          originalName: file.name,
          sizeBytes: file.sizeBytes,
        },
        mimeType: file.mimeType || null,
        projectId,
        source: "IMPORTED",
        title: file.name,
      }))
    );

    await indexer.indexDocuments(documents);

    return documents.map(toProjectDocumentDto);
  }

  async function updateProjectDocument(
    userId: string,
    projectId: string,
    documentId: string,
    input: ProjectDocumentInput
  ): Promise<ProjectDocumentDto> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const existingDocument = await repository.findProjectDocument(projectId, documentId);

    if (!existingDocument) {
      throw new AppError("Project document was not found.", 404, "PROJECT_DOCUMENT_NOT_FOUND");
    }

    if (existingDocument.source === "IMPORTED") {
      throw new AppError(
        "Imported project files are read-only. Delete and import the file again to replace it.",
        409,
        "PROJECT_DOCUMENT_READ_ONLY"
      );
    }

    const document = await repository.updateProjectDocument({
      content: input.content,
      documentId,
      mimeType: input.mimeType || null,
      projectId,
      title: input.title,
    });

    if (!document) {
      throw new AppError("Project document was not found.", 404, "PROJECT_DOCUMENT_NOT_FOUND");
    }

    await indexer.indexDocument(document);

    return toProjectDocumentDto(document);
  }

  async function deleteProjectDocument(userId: string, projectId: string, documentId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);

    const deletedCount = await repository.deleteProjectDocument(projectId, documentId);

    if (deletedCount === 0) {
      throw new AppError("Project document was not found.", 404, "PROJECT_DOCUMENT_NOT_FOUND");
    }
  }

  return {
    createProjectDocument,
    deleteProjectDocument,
    importProjectDocuments,
    listProjectDocuments,
    updateProjectDocument,
  };
}

function toProjectDocumentDto(document: ProjectDocumentRecord): ProjectDocumentDto {
  return {
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    content: document.content,
    source: document.source,
    mimeType: document.mimeType,
    metadata: toProjectDocumentMetadata(document.metadata),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toProjectDocumentMetadata(metadata: unknown): ProjectDocumentMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const value = metadata as Record<string, unknown>;
  const originalName = typeof value.originalName === "string" ? value.originalName : undefined;
  const sizeBytes = typeof value.sizeBytes === "number" ? value.sizeBytes : undefined;

  if (!originalName && sizeBytes === undefined) return null;

  return {
    ...(originalName ? { originalName } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  };
}

export const projectDocumentsService = createProjectDocumentsService({
  indexer: projectDocumentIndexer,
  projectAccess: projectAccessService,
  repository: projectDocumentsRepository,
});
