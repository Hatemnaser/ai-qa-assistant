import { projectMemoryRepository } from "./project-memory.repository.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { projectMemoryInputSchema } from "./project-memory.schema.js";
import type {
  ProjectMemoryDto,
  ProjectMemoryInput,
  ProjectMemoryRecord,
  ProjectMemoryRepository,
} from "./project-memory.types.js";

export interface ProjectMemoryServiceDependencies {
  projectAccess: ProjectAccessService;
  repository: ProjectMemoryRepository;
}

export function createProjectMemoryService({
  projectAccess,
  repository,
}: ProjectMemoryServiceDependencies) {
  async function getProjectMemory(
    userId: string,
    projectId: string
  ): Promise<ProjectMemoryDto | null> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const memory = await repository.findProjectMemory(projectId);

    return memory ? toProjectMemoryDto(memory) : null;
  }

  async function saveProjectMemory(
    userId: string,
    projectId: string,
    input: ProjectMemoryInput
  ): Promise<ProjectMemoryDto | null> {
    await projectAccess.assertProjectAccess(userId, projectId);
    const normalizedInput = projectMemoryInputSchema.parse(input);

    if (!normalizedInput.content) {
      await repository.deleteProjectMemory(projectId);
      return null;
    }

    return toProjectMemoryDto(
      await repository.upsertProjectMemory(projectId, normalizedInput.content)
    );
  }

  return {
    getProjectMemory,
    saveProjectMemory,
  };
}

function toProjectMemoryDto(memory: ProjectMemoryRecord): ProjectMemoryDto {
  return {
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    projectId: memory.projectId,
    source: memory.source,
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export const projectMemoryService = createProjectMemoryService({
  projectAccess: projectAccessService,
  repository: projectMemoryRepository,
});
