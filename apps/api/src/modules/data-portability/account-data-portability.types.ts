import type {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../generated/prisma/enums.js";

export const ACCOUNT_EXPORT_FORMAT_VERSION = "1.0";

export const ACCOUNT_EXPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 50_000_000,
  maxEntries: 10_000,
  maxEntryBytes: 25_000_000,
  maxTotalEntryBytes: 200_000_000,
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
}

export interface AccountExportManifestFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface AccountExportManifest {
  formatVersion: typeof ACCOUNT_EXPORT_FORMAT_VERSION;
  exportType: "account";
  exportedAt: string;
  accountId: string;
  counts: {
    projects: number;
    documents: number;
    chats: number;
    messages: number;
    accountMemories: number;
  };
  contains: {
    canonicalJson: true;
    readableMarkdown: true;
    migrationReference: true;
    attachmentFiles: false;
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
