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
