import { timingSafeEqual } from "node:crypto";

import { AppError } from "../../lib/errors.js";
import {
  createAccountMemoryExportPackage,
  normalizeAccountMemoryContent,
  validateAccountMemoryImportPackage,
} from "./account-memory-package.js";
import {
  accountMemoryPortabilityRepository,
  type AccountMemoryPortabilityRepository,
} from "./account-memory-portability.repository.js";
import {
  ACCOUNT_MEMORY_EXPORT_TYPE,
  ACCOUNT_MEMORY_FORMAT_VERSION,
  type AccountMemoryExportPackage,
  type AccountMemoryImportCommitResult,
  type AccountMemoryImportPreview,
  type ValidatedAccountMemoryImportPackage,
} from "./account-memory-portability.types.js";

const DUPLICATE_WARNING =
  "Exact duplicate Account Memory records were skipped.";

export interface AccountMemoryPortabilityService {
  commitAccountMemoryImport(
    userId: string,
    payload: Buffer,
    previewDigest: string
  ): Promise<AccountMemoryImportCommitResult>;
  exportAccountMemories(userId: string): Promise<AccountMemoryExportPackage>;
  previewAccountMemoryImport(
    userId: string,
    payload: Buffer
  ): Promise<AccountMemoryImportPreview>;
}

export interface AccountMemoryPortabilityServiceDependencies {
  now?: () => Date;
  repository: AccountMemoryPortabilityRepository;
}

export function createAccountMemoryPortabilityService({
  now = () => new Date(),
  repository,
}: AccountMemoryPortabilityServiceDependencies): AccountMemoryPortabilityService {
  return {
    async commitAccountMemoryImport(userId, payload, previewDigest) {
      const packageData = validateAccountMemoryImportPackage(payload);

      if (!digestsMatch(packageData.packageDigest, previewDigest)) {
        throw new AppError(
          "Account Memory import package does not match the previewed package.",
          409,
          "ACCOUNT_MEMORY_IMPORT_DIGEST_MISMATCH"
        );
      }

      const imported = await repository.importAccountMemories(
        userId,
        packageData.memories
      );
      const skippedDuplicates =
        packageData.intraPackageDuplicates +
        imported.skippedExistingDuplicates;

      return {
        imported: {
          memories: imported.created,
          skippedDuplicates,
        },
        currentMemoryCount: imported.currentMemoryCount,
        warnings: buildWarnings(packageData, skippedDuplicates),
      };
    },

    async exportAccountMemories(userId) {
      const memories = await repository.listAccountMemories(userId);

      return createAccountMemoryExportPackage(userId, memories, now());
    },

    async previewAccountMemoryImport(userId, payload) {
      const packageData = validateAccountMemoryImportPackage(payload);
      const currentMemories = await repository.listAccountMemories(userId);
      const normalizedCurrentContents = new Set(
        currentMemories.map((memory) =>
          normalizeAccountMemoryContent(memory.content)
        )
      );
      const existingDuplicates = packageData.memories.filter((memory) =>
        normalizedCurrentContents.has(
          normalizeAccountMemoryContent(memory.content)
        )
      ).length;
      const exactDuplicates =
        packageData.intraPackageDuplicates + existingDuplicates;

      return {
        compatible: true,
        formatVersion: ACCOUNT_MEMORY_FORMAT_VERSION,
        exportType: ACCOUNT_MEMORY_EXPORT_TYPE,
        packageDigest: packageData.packageDigest,
        counts: {
          packageRecords: packageData.packageRecords,
          importableRecords:
            packageData.packageRecords - exactDuplicates,
          exactDuplicates,
        },
        currentMemoryCount: currentMemories.length,
        warnings: buildWarnings(packageData, exactDuplicates),
      };
    },
  };
}

export const accountMemoryPortabilityService =
  createAccountMemoryPortabilityService({
    repository: accountMemoryPortabilityRepository,
  });

function buildWarnings(
  packageData: ValidatedAccountMemoryImportPackage,
  duplicateCount: number
) {
  const warnings = [...packageData.warnings];

  if (duplicateCount > 0) {
    warnings.push(DUPLICATE_WARNING);
  }

  return Array.from(new Set(warnings));
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
