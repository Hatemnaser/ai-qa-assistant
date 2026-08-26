import type {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../generated/prisma/enums.js";
import { DATA_LIMITS } from "../../config/data-limits.js";
import type { ProjectDocumentRecord } from "../project-documents/project-documents.types.js";
import type {
  PortableBinaryAssetDescriptor,
  PortableBinaryAssetSource,
  ValidatedPortableBinaryAsset,
} from "./binary-assets.js";
import type { UploadedPortableBinaryAsset } from "./binary-asset-restore.types.js";

export const PROJECT_EXPORT_LEGACY_FORMAT_VERSION = "1.0";
export const PROJECT_EXPORT_FORMAT_VERSION = "2.0";
export type ProjectExportFormatVersion =
  | typeof PROJECT_EXPORT_LEGACY_FORMAT_VERSION
  | typeof PROJECT_EXPORT_FORMAT_VERSION;

export const PROJECT_EXPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 8_000_000,
  maxEntries: 400,
  maxEntryBytes: 5_000_000,
  maxTotalEntryBytes: 16_000_000,
  maxDocuments: DATA_LIMITS.documentsPerProject,
  maxChats: DATA_LIMITS.chatsPerUser,
  maxMessages: DATA_LIMITS.chatsPerUser * DATA_LIMITS.messagesPerChat,
  maxMessagesPerChat: DATA_LIMITS.messagesPerChat,
  maxMessageChars: DATA_LIMITS.chatMessageContentChars,
  maxTotalTextChars: 4_000_000,
});

export const PROJECT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 8_000_000,
  maxEntries: 400,
  maxEntryBytes: 5_000_000,
  maxNestingDepth: 10,
  maxPathChars: 240,
  maxTotalUncompressedBytes: 16_000_000,
  maxDocuments: DATA_LIMITS.documentsPerProject,
  maxChats: DATA_LIMITS.chatsPerUser,
  maxMessages: DATA_LIMITS.chatsPerUser * DATA_LIMITS.messagesPerChat,
  maxMessagesPerChat: DATA_LIMITS.messagesPerChat,
  maxMessageChars: DATA_LIMITS.chatMessageContentChars,
  maxTotalTextChars: 4_000_000,
});

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
  binaryAssets: PortableBinaryAssetSource[];
}

export interface ProjectExportFileManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

interface ProjectExportManifestBase {
  exportType: "project";
  exportedAt: string;
  projectId: string;
  projectName: string;
  warnings: string[];
  files: ProjectExportFileManifestEntry[];
}

export interface ProjectExportManifestV1 extends ProjectExportManifestBase {
  formatVersion: typeof PROJECT_EXPORT_LEGACY_FORMAT_VERSION;
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
}

export interface ProjectExportManifestV2 extends ProjectExportManifestBase {
  formatVersion: typeof PROJECT_EXPORT_FORMAT_VERSION;
  include: {
    assets: true;
    chats: boolean;
    documents: true;
    readable: true;
  };
  counts: {
    assetBytes: number;
    assets: number;
    documents: number;
    chats: number;
    messages: number;
  };
  assets: PortableBinaryAssetDescriptor[];
}

export type ProjectExportManifest =
  | ProjectExportManifestV1
  | ProjectExportManifestV2;

export interface ProjectExportPackage {
  archive: Buffer;
  downloadFilename: string;
  manifest: ProjectExportManifest;
}

export interface ProjectExportOptions {
  includeChats: boolean;
}

export interface ProjectImportPreview {
  compatible: true;
  formatVersion: ProjectExportFormatVersion;
  exportType: "project";
  packageDigest: string;
  suggestedProjectName: string;
  sourceProjectName: string;
  counts: {
    assetBytes?: number;
    assets?: number;
    documents: number;
    chats: number;
    messages: number;
  };
  warnings: string[];
  unsupported: string[];
}

export interface ProjectImportDocument {
  sourceId: string;
  title: string;
  content: string;
  mimeType: string | null;
  metadata: {
    originalName: string;
    sizeBytes: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectImportMessage {
  sourceId: string;
  role: "user" | "assistant" | "system";
  content: string;
  mode: string;
  model: string | null;
  attachments: Array<{
    type: "image" | "file";
    name: string;
    mimeType: string;
  }>;
  isError: boolean;
  createdAt: Date;
}

export interface ProjectImportChat {
  sourceId: string;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ProjectImportMessage[];
}

export interface ValidatedProjectImportPackage {
  formatVersion: ProjectExportFormatVersion;
  packageDigest: string;
  project: {
    sourceId: string;
    name: string;
    description: string | null;
    instructions: {
      content: string;
    } | null;
    memory: {
      content: string;
    } | null;
    documents: ProjectImportDocument[];
    chats: ProjectImportChat[];
    binaryAssets: ValidatedPortableBinaryAsset[];
  };
  warnings: string[];
  unsupported: string[];
}

export interface ProjectImportCommitResult {
  projectId: string;
  projectName: string;
  imported: {
    documents: number;
    chats: number;
    messages: number;
    assets?: number;
  };
  warnings: string[];
}

export interface PersistedProjectImport {
  projectId: string;
  projectName: string;
  documents: ProjectDocumentRecord[];
  counts: {
    documents: number;
    chats: number;
    messages: number;
    assets?: number;
  };
}

export interface DataPortabilityRepository {
  createImportedProject(
    userId: string,
    packageData: ValidatedProjectImportPackage,
    uploadedAssets?: readonly UploadedPortableBinaryAsset[]
  ): Promise<PersistedProjectImport>;
  findOwnedProjectExportData(
    userId: string,
    projectId: string,
    includeChats: boolean
  ): Promise<ProjectExportSourceRecord | null>;
  findProjectDocumentIndexStatuses(
    projectId: string,
    documentIds: string[]
  ): Promise<Array<{ id: string; indexStatus: "PENDING" | "READY" | "FAILED" }>>;
}
