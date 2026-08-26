import type { ProjectDocumentRecord } from "../project-documents/project-documents.types.js";
import { DATA_LIMITS } from "../../config/data-limits.js";
import type { ValidatedExternalChatImport } from "./external-chat-import.types.js";
import type { ValidatedPortableBinaryAsset } from "./binary-assets.js";
import type { UploadedPortableBinaryAsset } from "./binary-asset-restore.types.js";

export const ACCOUNT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 10_000_000,
  maxEntries: 600,
  maxEntryBytes: 5_000_000,
  maxNestingDepth: 10,
  maxPathChars: 240,
  maxTotalUncompressedBytes: 20_000_000,
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

export type AccountImportKind = "account_archive" | "chat_archive";

export interface AccountImportCounts {
  projects: number;
  documents: number;
  chats: number;
  messages: number;
  accountMemories: number;
  binaryAssets?: number;
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
  binaryAssets: ValidatedPortableBinaryAsset[];
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

export interface AccountImportRepository {
  createImportedAccount(
    userId: string,
    packageData: ValidatedNativeAccountImport,
    uploadedAssets?: readonly UploadedPortableBinaryAsset[]
  ): Promise<PersistedNativeAccountImport>;
  findDocumentIndexStatuses(
    documentIds: string[]
  ): Promise<Array<{ id: string; indexStatus: "PENDING" | "READY" | "FAILED" }>>;
}
