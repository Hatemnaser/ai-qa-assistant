import { timingSafeEqual } from "node:crypto";

import { AppError } from "../../lib/errors.js";
import { assetStorage, type AssetStorage } from "../assets/assets.storage.js";
import {
  projectDocumentIndexer,
  type ProjectDocumentIndexer,
} from "../project-documents/project-document-index.service.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { dataPortabilityRepository } from "./data-portability.repository.js";
import { collectPortableBinaryAssets } from "./binary-assets.js";
import { binaryAssetRestoreService } from "./binary-asset-restore.service.js";
import type { BinaryAssetRestoreService } from "./binary-asset-restore.types.js";
import { createProjectExportPackage } from "./export-package.js";
import {
  previewProjectImportPackage,
  validateProjectImportPackage,
} from "./import-package.js";
import type {
  DataPortabilityRepository,
  ProjectImportCommitResult,
  ProjectImportPreview,
  ProjectExportOptions,
  ProjectExportPackage,
} from "./data-portability.types.js";

const INDEXING_WARNING =
  "Project documents were imported, but one or more documents are still pending or failed indexing. The canonical document content remains available for retry.";

export interface DataPortabilityService {
  commitProjectImport(
    userId: string,
    archive: Buffer,
    previewDigest: string
  ): Promise<ProjectImportCommitResult>;
  exportOwnedProject(
    userId: string,
    projectId: string,
    options: ProjectExportOptions
  ): Promise<ProjectExportPackage>;
  previewProjectImport(archive: Buffer): Promise<ProjectImportPreview>;
}

export interface DataPortabilityServiceDependencies {
  binaryAssetRestore?: BinaryAssetRestoreService;
  indexer: ProjectDocumentIndexer;
  now?: () => Date;
  projectAccess: ProjectAccessService;
  repository: DataPortabilityRepository;
  storage?: Pick<AssetStorage, "readObject">;
}

export function createDataPortabilityService({
  binaryAssetRestore = binaryAssetRestoreService,
  indexer,
  now = () => new Date(),
  projectAccess,
  repository,
  storage = assetStorage,
}: DataPortabilityServiceDependencies): DataPortabilityService {
  return {
    async commitProjectImport(userId, archive, previewDigest) {
      const packageData = validateProjectImportPackage(archive);

      if (!digestsMatch(packageData.packageDigest, previewDigest)) {
        throw new AppError(
          "Project import package does not match the previewed package.",
          409,
          "PROJECT_IMPORT_DIGEST_MISMATCH"
        );
      }

      const imported = await binaryAssetRestore.runWithPreparedAssets(
        userId,
        packageData.project.binaryAssets,
        (uploadedAssets) =>
          repository.createImportedProject(userId, packageData, uploadedAssets)
      );
      const warnings = [
        ...packageData.warnings,
        ...packageData.unsupported,
      ];

      if (imported.documents.length > 0) {
        try {
          await indexer.indexDocuments(imported.documents, userId);

          const statuses = await repository.findProjectDocumentIndexStatuses(
            imported.projectId,
            imported.documents.map((document) => document.id)
          );

          if (
            statuses.length !== imported.documents.length ||
            statuses.some((document) => document.indexStatus !== "READY")
          ) {
            warnings.push(INDEXING_WARNING);
          }
        } catch {
          warnings.push(INDEXING_WARNING);
        }
      }

      return {
        projectId: imported.projectId,
        projectName: imported.projectName,
        imported: imported.counts,
        warnings: Array.from(new Set(warnings)),
      };
    },

    async exportOwnedProject(userId, projectId, options) {
      await projectAccess.assertProjectAccess(userId, projectId);

      const project = await repository.findOwnedProjectExportData(
        userId,
        projectId,
        options.includeChats
      );

      if (!project) {
        throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
      }

      const binaryAssets =
        project.binaryAssets.length > 0
          ? await collectPortableBinaryAssets(
              userId,
              project.binaryAssets,
              storage
            )
          : undefined;

      return createProjectExportPackage(project, options, now(), binaryAssets);
    },

    async previewProjectImport(archive) {
      return previewProjectImportPackage(archive);
    },
  };
}

export const dataPortabilityService = createDataPortabilityService({
  binaryAssetRestore: binaryAssetRestoreService,
  indexer: projectDocumentIndexer,
  projectAccess: projectAccessService,
  repository: dataPortabilityRepository,
  storage: assetStorage,
});

function digestsMatch(actualDigest: string, previewDigest: string) {
  if (
    !/^[a-f0-9]{64}$/.test(actualDigest) ||
    !/^[a-f0-9]{64}$/i.test(previewDigest)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(actualDigest, "hex"),
    Buffer.from(previewDigest, "hex")
  );
}
