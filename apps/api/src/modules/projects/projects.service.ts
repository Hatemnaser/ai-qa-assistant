import { ProjectRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import { env } from '../../config/env.js';
import { requestOwnerBrowserStop } from '../browser-runtime/browser-runtime.repository.js';
import { revokeSavedOwner } from '../browser-auth/browser-auth.repository.js';
import { projectsRepository } from "./projects.repository.js";
import type {
  ProjectDto,
  ProjectInput,
  ProjectRecord,
  ProjectsRepository,
} from "./projects.types.js";

export interface ProjectsServiceDependencies {
  repository: ProjectsRepository;
  requireBrowserStop?: (userId: string, projectId: string) => Promise<boolean>;
}

export function createProjectsService({ repository, requireBrowserStop = async () => true }: ProjectsServiceDependencies) {
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
    if (!await requireBrowserStop(userId, projectId)) throw new AppError('Browser Stop must be confirmed before deleting this project. Retry after Stop.', 409, 'BROWSER_STOP_REQUIRED');
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
  requireBrowserStop: async(userId,projectId)=>{const confirmed=await requestOwnerBrowserStop(userId,projectId);await revokeSavedOwner(userId,projectId);return confirmed;},
});
