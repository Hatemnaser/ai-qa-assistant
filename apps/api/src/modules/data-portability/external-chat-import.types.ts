export const EXTERNAL_CHAT_IMPORT_LIMITS = Object.freeze({
  maxCompressedBytes: 100_000_000,
  maxEntries: 10_000,
  maxEntryBytes: 100_000_000,
  maxNestingDepth: 12,
  maxPathChars: 240,
  maxTotalUncompressedBytes: 250_000_000,
  maxChats: 5_000,
  maxMessages: 100_000,
  maxMessageChars: 200_000,
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
