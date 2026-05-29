import { ProjectRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import {
  projectsRepository,
  type ProjectRecord,
  type ProjectsRepository,
} from "./projects.repository.js";
import type { ProjectDto, ProjectInput } from "./projects.types.js";

export interface ProjectsServiceDependencies {
  repository: ProjectsRepository;
}

export function createProjectsService({ repository }: ProjectsServiceDependencies) {
  async function listUserProjects(userId: string): Promise<ProjectDto[]> {
    const projects = await repository.listUserProjects(userId);

    return projects.map(toProjectDto);
  }

  async function createUserProject(userId: string, input: ProjectInput): Promise<ProjectDto> {
    const project = await repository.createUserProject({
      ...input,
      ownerId: userId,
    });

    return toProjectDto(project);
  }

  async function updateUserProject(userId: string, projectId: string, input: ProjectInput): Promise<ProjectDto> {
    const project = await repository.updateOwnedProject({
      ...input,
      projectId,
      userId,
    });

    if (!project) {
      throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
    }

    return toProjectDto(project);
  }

  async function deleteUserProject(userId: string, projectId: string) {
    const deletedCount = await repository.deleteOwnedProject(userId, projectId);

    if (deletedCount === 0) {
      throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
    }
  }

  return {
    createUserProject,
    deleteUserProject,
    listUserProjects,
    updateUserProject,
  };
}

function toProjectDto(project: ProjectRecord): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    role: ProjectRole.OWNER,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export const projectsService = createProjectsService({
  repository: projectsRepository,
});
