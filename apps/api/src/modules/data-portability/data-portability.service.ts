import { AppError } from "../../lib/errors.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import {
  dataPortabilityRepository,
  type DataPortabilityRepository,
} from "./data-portability.repository.js";
import { createProjectExportPackage } from "./export-package.js";
import { previewProjectImportPackage } from "./import-package.js";
import type {
  ProjectImportPreview,
  ProjectExportOptions,
  ProjectExportPackage,
} from "./data-portability.types.js";

export interface DataPortabilityService {
  exportOwnedProject(
    userId: string,
    projectId: string,
    options: ProjectExportOptions
  ): Promise<ProjectExportPackage>;
  previewProjectImport(archive: Buffer): Promise<ProjectImportPreview>;
}

export interface DataPortabilityServiceDependencies {
  now?: () => Date;
  projectAccess: ProjectAccessService;
  repository: DataPortabilityRepository;
}

export function createDataPortabilityService({
  now = () => new Date(),
  projectAccess,
  repository,
}: DataPortabilityServiceDependencies): DataPortabilityService {
  return {
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

      return createProjectExportPackage(project, options, now());
    },

    async previewProjectImport(archive) {
      return previewProjectImportPackage(archive);
    },
  };
}

export const dataPortabilityService = createDataPortabilityService({
  projectAccess: projectAccessService,
  repository: dataPortabilityRepository,
});
