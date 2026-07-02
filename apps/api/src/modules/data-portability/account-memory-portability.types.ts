import type { MemorySource } from "../../generated/prisma/enums.js";

export const ACCOUNT_MEMORY_FORMAT_VERSION = "1.0";
export const ACCOUNT_MEMORY_EXPORT_TYPE = "account_memories";

export const ACCOUNT_MEMORY_IMPORT_LIMITS = Object.freeze({
  maxContentChars: 4_000,
  maxPayloadBytes: 1_000_000,
  maxRecords: 100,
});

export type PortableAccountMemorySource = "USER_PROVIDED" | "IMPORTED";

export interface AccountMemoryPortabilityRecord {
  id: string;
  content: string;
  source: MemorySource;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortableAccountMemoryRecord {
  sourceId: string;
  content: string;
  source: PortableAccountMemorySource;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountMemoryExportDocument {
  formatVersion: typeof ACCOUNT_MEMORY_FORMAT_VERSION;
  exportType: typeof ACCOUNT_MEMORY_EXPORT_TYPE;
  exportedAt: string;
  account: {
    sourceUserId: string;
  };
  memories: PortableAccountMemoryRecord[];
  warnings: string[];
}

export interface AccountMemoryExportPackage {
  document: AccountMemoryExportDocument;
  downloadFilename: string;
  payload: Buffer;
}

export interface ValidatedAccountMemoryImportPackage {
  packageDigest: string;
  packageRecords: number;
  intraPackageDuplicates: number;
  memories: PortableAccountMemoryRecord[];
  warnings: string[];
}

export interface AccountMemoryImportPreview {
  compatible: true;
  formatVersion: typeof ACCOUNT_MEMORY_FORMAT_VERSION;
  exportType: typeof ACCOUNT_MEMORY_EXPORT_TYPE;
  packageDigest: string;
  counts: {
    packageRecords: number;
    importableRecords: number;
    exactDuplicates: number;
  };
  currentMemoryCount: number;
  warnings: string[];
}

export interface PersistedAccountMemoryImport {
  created: number;
  skippedExistingDuplicates: number;
  currentMemoryCount: number;
}

export interface AccountMemoryImportCommitResult {
  imported: {
    memories: number;
    skippedDuplicates: number;
  };
  currentMemoryCount: number;
  warnings: string[];
}
