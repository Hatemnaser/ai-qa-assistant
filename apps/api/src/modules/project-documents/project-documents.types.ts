export type ProjectDocumentSource = "USER_PROVIDED" | "IMPORTED";

export interface ProjectDocumentMetadata {
  originalName?: string;
  sizeBytes?: number;
}

export interface ProjectDocumentDto {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  mimeType: string | null;
  metadata: ProjectDocumentMetadata | null;
  sourceAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocumentInput {
  title: string;
  content: string;
  mimeType?: string | null;
}

export interface ProjectDocumentRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  mimeType: string | null;
  metadata: unknown | null;
  contentHash: string;
  chunkingVersion: string;
  indexStatus: "PENDING" | "READY" | "FAILED";
  indexError: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sourceAssetId: string | null;
}

export interface CreateProjectDocumentInput extends ProjectDocumentInput {
  metadata?: ProjectDocumentMetadata | null;
  projectId: string;
  source?: ProjectDocumentSource;
  sourceAssetId?: string | null;
  sourceAssetOwnerId?: string;
}

export interface UpdateProjectDocumentInput extends ProjectDocumentInput {
  documentId: string;
  projectId: string;
}

export interface ProjectDocumentsRepository {
  createProjectDocument(input: CreateProjectDocumentInput): Promise<ProjectDocumentRecord>;
  createProjectDocuments(inputs: CreateProjectDocumentInput[]): Promise<ProjectDocumentRecord[]>;
  deleteProjectDocument(projectId: string, documentId: string): Promise<number>;
  findProjectDocument(projectId: string, documentId: string): Promise<ProjectDocumentRecord | null>;
  listProjectDocuments(projectId: string): Promise<ProjectDocumentRecord[]>;
  updateProjectDocument(input: UpdateProjectDocumentInput): Promise<ProjectDocumentRecord | null>;
}

export interface ProjectDocumentInlineImportFileInput {
  name: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ProjectDocumentStoredImportFileInput {
  sourceAssetId: string;
}

export type ProjectDocumentImportFileInput =
  | ProjectDocumentInlineImportFileInput
  | ProjectDocumentStoredImportFileInput;

export interface ProjectDocumentImportInput {
  files: ProjectDocumentImportFileInput[];
}
