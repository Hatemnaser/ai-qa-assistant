import type {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../generated/prisma/enums.js";
import { DATA_LIMITS } from "../../config/data-limits.js";
import type { PortableBinaryAssetSource } from "./binary-assets.js";

export const ACCOUNT_EXPORT_FORMAT_VERSION = "1.0";
export const ACCOUNT_EXPORT_BINARY_FORMAT_VERSION = "2.0";

export type AccountExportFormatVersion =
  | typeof ACCOUNT_EXPORT_FORMAT_VERSION
  | typeof ACCOUNT_EXPORT_BINARY_FORMAT_VERSION;

export const ACCOUNT_EXPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 10_000_000,
  maxEntries: 600,
  maxEntryBytes: 5_000_000,
  maxTotalEntryBytes: 20_000_000,
  maxProjects: DATA_LIMITS.projectsPerUser,
  maxDocuments:
    DATA_LIMITS.projectsPerUser * DATA_LIMITS.documentsPerProject,
  maxChats: DATA_LIMITS.chatsPerUser,
  maxMessages: DATA_LIMITS.chatsPerUser * DATA_LIMITS.messagesPerChat,
  maxMessagesPerChat: DATA_LIMITS.messagesPerChat,
  maxAccountMemories: DATA_LIMITS.accountMemoriesPerUser,
  maxMessageChars: DATA_LIMITS.chatMessageContentChars,
  maxDocumentBytes: DATA_LIMITS.projectDocumentSourceBytes,
  maxTotalTextChars: 5_000_000,
});

export interface AccountExportMemoryRecord {
  id: string;
  content: string;
  source: MemorySource;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountExportDocumentRecord {
  id: string;
  title: string;
  content: string;
  source: ProjectDocumentSource;
  mimeType: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountExportProjectRecord {
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
  documents: AccountExportDocumentRecord[];
}

export interface AccountExportMessageRecord {
  id: string;
  role: ChatRole;
  content: string;
  mode: string;
  model: string | null;
  attachment: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface AccountExportChatRecord {
  id: string;
  projectId: string | null;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AccountExportMessageRecord[];
}

export interface AccountExportSourceRecord {
  id: string;
  acceptedTermsAt: Date | null;
  acceptedTermsVersion: string | null;
  email: string;
  name: string | null;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    language: string;
    theme: string;
    defaultModel: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  memories: AccountExportMemoryRecord[];
  projects: AccountExportProjectRecord[];
  chats: AccountExportChatRecord[];
  binaryAssets: PortableBinaryAssetSource[];
}

export interface AccountDataPortabilityRepository {
  findAccountExportData(userId: string): Promise<AccountExportSourceRecord | null>;
}

export interface AccountExportManifestFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface AccountExportManifest {
  formatVersion: AccountExportFormatVersion;
  exportType: "account";
  exportedAt: string;
  accountId: string;
  counts: {
    projects: number;
    documents: number;
    chats: number;
    messages: number;
    accountMemories: number;
    binaryAssets?: number;
  };
  contains: {
    canonicalJson: true;
    readableMarkdown: true;
    migrationReference: true;
    attachmentFiles: boolean;
    privateAssetFiles?: boolean;
    derivedData: false;
    secrets: false;
  };
  warnings: string[];
  files: AccountExportManifestFile[];
}

export interface AccountExportPackage {
  archive: Buffer;
  downloadFilename: string;
  manifest: AccountExportManifest;
}
