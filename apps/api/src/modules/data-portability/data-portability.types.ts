import type {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../generated/prisma/enums.js";

export const PROJECT_EXPORT_FORMAT_VERSION = "1.0";

export interface ProjectExportDocumentRecord {
  id: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  mimeType: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectExportMessageRecord {
  id: string;
  role: ChatRole;
  content: string;
  mode: string;
  model: string | null;
  attachment: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface ProjectExportChatRecord {
  id: string;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ProjectExportMessageRecord[];
}

export interface ProjectExportSourceRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  instruction: {
    content: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  projectMemory: {
    content: string;
    source: MemorySource;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  documents: ProjectExportDocumentRecord[];
  chats: ProjectExportChatRecord[];
}

export interface ProjectExportFileManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface ProjectExportManifest {
  formatVersion: typeof PROJECT_EXPORT_FORMAT_VERSION;
  exportType: "project";
  exportedAt: string;
  projectId: string;
  projectName: string;
  include: {
    chats: boolean;
    documents: true;
    readable: true;
  };
  counts: {
    documents: number;
    chats: number;
    messages: number;
  };
  warnings: string[];
  files: ProjectExportFileManifestEntry[];
}

export interface ProjectExportPackage {
  archive: Buffer;
  downloadFilename: string;
  manifest: ProjectExportManifest;
}

export interface ProjectExportOptions {
  includeChats: boolean;
}
