import type { ProjectRole } from "../../generated/prisma/enums.js";

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  role: ProjectRole;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  description: string | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput extends ProjectInput {
  ownerId: string;
}

export interface UpdateProjectInput extends ProjectInput {
  projectId: string;
  userId: string;
}

export interface ProjectsRepository {
  createUserProject(input: CreateProjectInput): Promise<ProjectRecord>;
  deleteOwnedProject(userId: string, projectId: string): Promise<number>;
  findProjectOwner(projectId: string): Promise<{ ownerId: string } | null>;
  listUserProjects(userId: string): Promise<ProjectRecord[]>;
  updateOwnedProject(input: UpdateProjectInput): Promise<ProjectRecord | null>;
}
