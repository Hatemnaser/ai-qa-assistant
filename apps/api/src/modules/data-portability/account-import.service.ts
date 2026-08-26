import { timingSafeEqual } from "node:crypto";

import { AppError } from "../../lib/errors.js";
import {
  projectDocumentIndexer,
  type ProjectDocumentIndexer,
} from "../project-documents/project-document-index.service.js";
import { accountImportRepository } from "./account-import.repository.js";
import { binaryAssetRestoreService } from "./binary-asset-restore.service.js";
import type { BinaryAssetRestoreService } from "./binary-asset-restore.types.js";
import { validateAccountImportPackage } from "./account-import-package.js";
import type {
  AccountImportCommitResult,
  AccountImportCounts,
  AccountImportPreview,
  AccountImportRepository,
  ValidatedAccountImport,
} from "./account-import.types.js";
import { externalChatImportRepository } from "./external-chat-import.repository.js";
import type { ExternalChatImportRepository } from "./external-chat-import.types.js";

const INDEXING_WARNING =
  "Account data was imported, but one or more Project Documents are still pending or failed indexing. Canonical document content remains available for retry.";

export interface AccountImportService {
  commit(
    userId: string,
    archive: Buffer,
    previewDigest: string
  ): Promise<AccountImportCommitResult>;
  preview(archive: Buffer): Promise<AccountImportPreview>;
}

export interface AccountImportServiceDependencies {
  accountRepository: AccountImportRepository;
  binaryAssetRestore?: BinaryAssetRestoreService;
  externalRepository: ExternalChatImportRepository;
  indexer: ProjectDocumentIndexer;
}

export function createAccountImportService({
  accountRepository,
  binaryAssetRestore = binaryAssetRestoreService,
  externalRepository,
  indexer,
}: AccountImportServiceDependencies): AccountImportService {
  return {
    async commit(userId, archive, previewDigest) {
      const packageData = validateAccountImportPackage(archive);

      if (!digestsMatch(packageData.packageDigest, previewDigest)) {
        throw new AppError(
          "Account import file does not match the previewed file.",
          409,
          "ACCOUNT_IMPORT_DIGEST_MISMATCH"
        );
      }

      if (packageData.importKind === "chat_archive") {
        const imported = await externalRepository.createImportedChats(
          userId,
          packageData.external
        );

        return {
          importKind: packageData.importKind,
          imported: {
            projects: 0,
            documents: 0,
            chats: imported.chats,
            messages: imported.messages,
            accountMemories: 0,
          },
          skipped: { accountMemories: 0 },
          warnings: packageData.warnings,
        };
      }

      const persisted = await binaryAssetRestore.runWithPreparedAssets(
        userId,
        packageData.binaryAssets,
        (uploadedAssets) =>
          accountRepository.createImportedAccount(
            userId,
            packageData,
            uploadedAssets
          )
      );
      const warnings = [...packageData.warnings];

      if (persisted.documents.length > 0) {
        try {
          await indexer.indexDocuments(persisted.documents, userId);
          const statuses = await accountRepository.findDocumentIndexStatuses(
            persisted.documents.map((document) => document.id)
          );

          if (
            statuses.length !== persisted.documents.length ||
            statuses.some((document) => document.indexStatus !== "READY")
          ) {
            warnings.push(INDEXING_WARNING);
          }
        } catch {
          warnings.push(INDEXING_WARNING);
        }
      }

      return {
        importKind: packageData.importKind,
        imported: persisted.counts,
        skipped: {
          accountMemories: persisted.skippedAccountMemories,
        },
        warnings: Array.from(new Set(warnings)),
      };
    },

    async preview(archive) {
      const packageData = validateAccountImportPackage(archive);

      return {
        compatible: true,
        importKind: packageData.importKind,
        packageDigest: packageData.packageDigest,
        counts: getCounts(packageData),
        warnings: packageData.warnings,
      };
    },
  };
}

export const accountImportService = createAccountImportService({
  accountRepository: accountImportRepository,
  binaryAssetRestore: binaryAssetRestoreService,
  externalRepository: externalChatImportRepository,
  indexer: projectDocumentIndexer,
});

function getCounts(packageData: ValidatedAccountImport): AccountImportCounts {
  if (packageData.importKind === "chat_archive") {
    return {
      projects: 0,
      documents: 0,
      chats: packageData.external.chats.length,
      messages: packageData.external.chats.reduce(
        (total, chat) => total + chat.messages.length,
        0
      ),
      accountMemories: 0,
    };
  }

  return {
    projects: packageData.projects.length,
    documents: packageData.projects.reduce(
      (total, project) => total + project.documents.length,
      0
    ),
    chats: packageData.chats.length,
    messages: packageData.chats.reduce(
      (total, chat) => total + chat.messages.length,
      0
    ),
    accountMemories: packageData.accountMemories.length,
    ...(packageData.binaryAssets.length > 0
      ? { binaryAssets: packageData.binaryAssets.length }
      : {}),
  };
}

function digestsMatch(actualDigest: string, previewDigest: string) {
  if (
    !/^[a-f0-9]{64}$/.test(actualDigest) ||
    !/^[a-f0-9]{64}$/i.test(previewDigest)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(actualDigest, "hex"),
    Buffer.from(previewDigest, "hex")
  );
}
