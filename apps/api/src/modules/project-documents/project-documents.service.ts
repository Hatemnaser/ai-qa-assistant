import { AppError } from "../../lib/errors.js";
import {
  assetConsumptionService,
  type AssetConsumptionService,
} from "../assets/assets-consumption.service.js";
import { projectDocumentsRepository } from "./project-documents.repository.js";
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
  ProjectDocumentRecord,
  ProjectDocumentsRepository,
} from "./project-documents.types.js";
import {
  PROJECT_DOCUMENT_IMPORT_POLICY,
  isSupportedProjectDocumentFile,
} from "./project-document-files.js";

export interface ProjectDocumentsServiceDependencies {
  assetConsumption?: AssetConsumptionService;
  indexer: ProjectDocumentIndexer;
  projectAccess: ProjectAccessService;
  repository: ProjectDocumentsRepository;
}

export function createProjectDocumentsService({
  assetConsumption,
  indexer,
  projectAccess,
  repository,
}: ProjectDocumentsServiceDependencies) {
  async function listProjectDocuments(userId: string, projectId: string): Promise<ProjectDocumentDto[]> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const documents = await repository.listProjectDocuments(projectId);

    await indexer.ensureDocumentsIndexed(documents, userId);

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

    await indexer.indexDocument(document, userId);

    return toProjectDocumentDto(document);
  }

  async function importProjectDocuments(
    userId: string,
    projectId: string,
    input: ProjectDocumentImportInput
  ): Promise<ProjectDocumentDto[]> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const preparedFiles = await Promise.all(
      input.files.map(async (file) => {
        if (!("sourceAssetId" in file)) {
          return {
            content: file.content,
            metadata: {
              originalName: file.name,
              sizeBytes: file.sizeBytes,
            },
            mimeType: file.mimeType || null,
            projectId,
            source: "IMPORTED" as const,
            sourceAssetId: null,
            title: file.name,
          };
        }

        if (!assetConsumption) {
          throw new AppError(
            "Private asset storage is unavailable.",
            503,
            "ASSET_STORAGE_DISABLED"
          );
        }

        const stored = await assetConsumption.readReadyOwnedAsset({
          assetId: file.sourceAssetId,
          ownerId: userId,
          projectId,
          purpose: "PROJECT_DOCUMENT_SOURCE",
        });
        const mimeType = stored.asset.detectedMimeType;

        if (!isSupportedProjectDocumentFile(stored.asset.originalName, mimeType)) {
          throw new AppError("Unsupported asset type.", 415, "ASSET_TYPE_UNSUPPORTED");
        }
        if (stored.bytes.byteLength > PROJECT_DOCUMENT_IMPORT_POLICY.maxFileBytes) {
          throw new AppError("Asset is too large.", 413, "ASSET_TOO_LARGE");
        }

        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
        } catch {
          throw new AppError("Stored document content is invalid.", 422, "ASSET_CONTENT_INVALID");
        }
        if (!content) {
          throw new AppError("Stored document content is empty.", 422, "ASSET_CONTENT_INVALID");
        }

        return {
          content,
          metadata: {
            originalName: stored.asset.originalName,
            sizeBytes: stored.asset.sizeBytes,
          },
          mimeType,
          projectId,
          source: "IMPORTED" as const,
          sourceAssetId: stored.asset.id,
          sourceAssetOwnerId: userId,
          title: stored.asset.originalName,
        };
      })
    );
    const documents = await repository.createProjectDocuments(preparedFiles);

    await indexer.indexDocuments(documents, userId);

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

    await indexer.indexDocument(document, userId);

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
    sourceAssetId: document.sourceAssetId,
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
  assetConsumption: assetConsumptionService,
  indexer: projectDocumentIndexer,
  projectAccess: projectAccessService,
  repository: projectDocumentsRepository,
});
