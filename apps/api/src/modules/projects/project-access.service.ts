import { AppError } from "../../lib/errors.js";
import { projectsRepository } from "./projects.repository.js";
import type { ProjectsRepository } from "./projects.types.js";

export interface ProjectAccessService {
  assertProjectAccess(userId: string, projectId: string): Promise<void>;
}

export function createProjectAccessService(
  repository: Pick<ProjectsRepository, "findProjectOwner">
): ProjectAccessService {
  return {
    async assertProjectAccess(userId, projectId) {
      const project = await repository.findProjectOwner(projectId);

      if (!project || project.ownerId !== userId) {
        throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
      }
    },
  };
}

export const projectAccessService = createProjectAccessService(projectsRepository);
