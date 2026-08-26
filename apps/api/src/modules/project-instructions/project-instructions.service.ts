import { projectInstructionsRepository } from "./project-instructions.repository.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import type {
  ProjectInstructionDto,
  ProjectInstructionInput,
  ProjectInstructionRecord,
  ProjectInstructionsRepository,
} from "./project-instructions.types.js";

export interface ProjectInstructionsServiceDependencies {
  projectAccess: ProjectAccessService;
  repository: ProjectInstructionsRepository;
}

export function createProjectInstructionsService({
  projectAccess,
  repository,
}: ProjectInstructionsServiceDependencies) {
  async function getProjectInstruction(userId: string, projectId: string): Promise<ProjectInstructionDto | null> {
    await projectAccess.assertProjectAccess(userId, projectId);

    const instruction = await repository.findProjectInstruction(projectId);

    return instruction ? toProjectInstructionDto(instruction) : null;
  }

  async function saveProjectInstruction(
    userId: string,
    projectId: string,
    input: ProjectInstructionInput
  ): Promise<ProjectInstructionDto | null> {
    await projectAccess.assertProjectAccess(userId, projectId);

    if (!input.content) {
      await repository.deleteProjectInstruction(projectId);
      return null;
    }

    return toProjectInstructionDto(await repository.upsertProjectInstruction(projectId, input.content));
  }

  return {
    getProjectInstruction,
    saveProjectInstruction,
  };
}

function toProjectInstructionDto(instruction: ProjectInstructionRecord): ProjectInstructionDto {
  return {
    projectId: instruction.projectId,
    content: instruction.content,
    createdAt: instruction.createdAt.toISOString(),
    updatedAt: instruction.updatedAt.toISOString(),
  };
}

export const projectInstructionsService = createProjectInstructionsService({
  projectAccess: projectAccessService,
  repository: projectInstructionsRepository,
});
