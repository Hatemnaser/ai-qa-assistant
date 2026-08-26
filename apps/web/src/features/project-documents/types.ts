export type ProjectDocumentSource = "USER_PROVIDED" | "IMPORTED";

export interface ProjectDocumentMetadata {
  originalName?: string;
  sizeBytes?: number;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  sourceAssetId?: string | null;
  mimeType: string | null;
  metadata: ProjectDocumentMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocumentInput {
  title: string;
  content: string;
  mimeType?: string | null;
}

export interface ProjectDocumentInlineImportFileInput {
  name: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ProjectDocumentAssetImportFileInput {
  sourceAssetId: string;
}

export type ProjectDocumentImportFileInput =
  | ProjectDocumentInlineImportFileInput
  | ProjectDocumentAssetImportFileInput;
