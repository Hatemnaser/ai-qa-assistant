export interface ProjectInstructionDto {
  projectId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInstructionInput {
  content: string;
}

export interface ProjectInstructionRecord {
  projectId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectInstructionsRepository {
  deleteProjectInstruction(projectId: string): Promise<void>;
  findProjectInstruction(projectId: string): Promise<ProjectInstructionRecord | null>;
  upsertProjectInstruction(projectId: string, content: string): Promise<ProjectInstructionRecord>;
}
