import type { ProjectAccessService } from "../../src/modules/projects/project-access.service.ts";

export function createFakeProjectAccess(
  projectOwners = new Map<string, string>()
): ProjectAccessService {
  return {
    async assertProjectAccess(userId, projectId) {
      if (projectOwners.get(projectId) !== userId) {
        throw Object.assign(new Error("Project was not found."), {
          code: "PROJECT_NOT_FOUND",
          statusCode: 404,
        });
      }
    },
  };
}
