import type { ProjectDocumentRecord } from "../project-documents/project-documents.repository.js";
import type { ValidatedExternalChatImport } from "./external-chat-import.types.js";

export const ACCOUNT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 100_000_000,
  maxEntries: 10_000,
  maxEntryBytes: 100_000_000,
  maxNestingDepth: 12,
  maxPathChars: 240,
  maxTotalUncompressedBytes: 250_000_000,
  maxProjects: 1_000,
  maxDocuments: 5_000,
  maxChats: 5_000,
  maxMessages: 100_000,
  maxAccountMemories: 10_000,
  maxMessageChars: 200_000,
});

export type AccountImportKind = "account_archive" | "chat_archive";

export interface AccountImportCounts {
  projects: number;
  documents: number;
  chats: number;
  messages: number;
  accountMemories: number;
}

export interface AccountImportPreview {
  compatible: true;
  importKind: AccountImportKind;
  packageDigest: string;
  counts: AccountImportCounts;
  warnings: string[];
}

export interface AccountImportCommitResult {
  importKind: AccountImportKind;
  imported: AccountImportCounts;
  skipped: {
    accountMemories: number;
  };
  warnings: string[];
}

export interface NativeAccountImportMemory {
  sourceId: string;
  content: string;
  source: "USER_PROVIDED" | "IMPORTED";
  createdAt: Date;
  updatedAt: Date;
}

export interface NativeAccountImportDocument {
  sourceId: string;
  title: string;
  content: string;
  mimeType: string | null;
  metadata: {
    originalName?: string;
    sizeBytes?: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NativeAccountImportProject {
  sourceId: string;
  name: string;
  description: string | null;
  instructions: { content: string } | null;
  memory: { content: string } | null;
  documents: NativeAccountImportDocument[];
  chatSourceIds: string[];
}

export interface NativeAccountImportMessage {
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

export interface NativeAccountImportChat {
  sourceId: string;
  sourceProjectId: string | null;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: NativeAccountImportMessage[];
}

export interface ValidatedNativeAccountImport {
  importKind: "account_archive";
  packageDigest: string;
  sourceAccountId: string;
  accountMemories: NativeAccountImportMemory[];
  projects: NativeAccountImportProject[];
  chats: NativeAccountImportChat[];
  warnings: string[];
}

export interface ValidatedExternalAccountImport {
  importKind: "chat_archive";
  packageDigest: string;
  external: ValidatedExternalChatImport;
  warnings: string[];
}

export type ValidatedAccountImport =
  | ValidatedNativeAccountImport
  | ValidatedExternalAccountImport;

export interface PersistedNativeAccountImport {
  counts: AccountImportCounts;
  skippedAccountMemories: number;
  documents: ProjectDocumentRecord[];
}
