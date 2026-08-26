import { DATA_LIMITS } from "../../config/data-limits.js";

export const EXTERNAL_CHAT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 10_000_000,
  maxEntries: 600,
  maxEntryBytes: 10_000_000,
  maxNestingDepth: 10,
  maxPathChars: 240,
  maxTotalUncompressedBytes: 20_000_000,
  maxChats: DATA_LIMITS.chatsPerUser,
  maxMessages: DATA_LIMITS.chatsPerUser * DATA_LIMITS.messagesPerChat,
  maxMessagesPerChat: DATA_LIMITS.messagesPerChat,
  maxMessageChars: DATA_LIMITS.chatMessageContentChars,
  maxTotalMessageChars: 5_000_000,
});

export type ExternalChatProvider = "chatgpt" | "claude";
export type ExternalChatProviderSelection = ExternalChatProvider | "auto";

export interface ExternalChatImportMessage {
  sourceId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date | null;
  originalModel: string | null;
}

export interface ExternalChatImportChat {
  sourceId: string;
  title: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  messages: ExternalChatImportMessage[];
}

export interface ValidatedExternalChatImport {
  packageDigest: string;
  provider: ExternalChatProvider;
  chats: ExternalChatImportChat[];
  warnings: string[];
}

export interface ExternalChatImportPreview {
  compatible: true;
  provider: ExternalChatProvider;
  packageDigest: string;
  counts: {
    chats: number;
    messages: number;
  };
  warnings: string[];
}

export interface ExternalChatImportCommitResult {
  imported: {
    chats: number;
    messages: number;
  };
  provider: ExternalChatProvider;
  warnings: string[];
}

export interface PersistedExternalChatImport {
  chats: number;
  messages: number;
}

export interface ExternalChatImportRepository {
  createImportedChats(
    userId: string,
    packageData: ValidatedExternalChatImport
  ): Promise<PersistedExternalChatImport>;
}
