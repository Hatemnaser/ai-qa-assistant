import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { AppError } from "../../lib/errors.js";
import { MemorySource } from "../../generated/prisma/enums.js";
import { accountMemoryImportPackageSchema } from "./account-memory-portability.schema.js";
import {
  ACCOUNT_MEMORY_EXPORT_TYPE,
  ACCOUNT_MEMORY_FORMAT_VERSION,
  ACCOUNT_MEMORY_IMPORT_LIMITS,
  type AccountMemoryExportDocument,
  type AccountMemoryExportPackage,
  type AccountMemoryPortabilityRecord,
  type PortableAccountMemoryRecord,
  type ValidatedAccountMemoryImportPackage,
} from "./account-memory-portability.types.js";

const PORTABLE_MEMORY_SOURCES = new Set<MemorySource>([
  MemorySource.USER_PROVIDED,
  MemorySource.IMPORTED,
]);

const EXCLUDED_SOURCE_WARNING =
  "Some Account Memory records were excluded because their source is not portable.";

export function createAccountMemoryExportPackage(
  userId: string,
  records: AccountMemoryPortabilityRecord[],
  exportedAt: Date
): AccountMemoryExportPackage {
  const portableRecords = records.filter((record) =>
    PORTABLE_MEMORY_SOURCES.has(record.source)
  );
  const warnings =
    portableRecords.length === records.length ? [] : [EXCLUDED_SOURCE_WARNING];
  const document: AccountMemoryExportDocument = {
    formatVersion: ACCOUNT_MEMORY_FORMAT_VERSION,
    exportType: ACCOUNT_MEMORY_EXPORT_TYPE,
    exportedAt: exportedAt.toISOString(),
    account: {
      sourceUserId: userId,
    },
    memories: portableRecords.map((record) => ({
      sourceId: record.id,
      content: record.content,
      source: toPortableSource(record.source),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
    warnings,
  };
  const validationResult =
    accountMemoryImportPackageSchema.safeParse(document);

  if (!validationResult.success) {
    throw new AppError(
      "Account Memory export exceeds the portable package limits.",
      422,
      "ACCOUNT_MEMORY_EXPORT_LIMIT_EXCEEDED"
    );
  }

  const validatedDocument = validationResult.data;
  const payload = Buffer.from(
    `${JSON.stringify(validatedDocument, null, 2)}\n`,
    "utf8"
  );

  if (payload.byteLength > ACCOUNT_MEMORY_IMPORT_LIMITS.maxPayloadBytes) {
    throw new AppError(
      "Account Memory export exceeds the portable package limits.",
      422,
      "ACCOUNT_MEMORY_EXPORT_LIMIT_EXCEEDED"
    );
  }

  return {
    document: validatedDocument,
    downloadFilename: "account-memories-export.json",
    payload,
  };
}

export function validateAccountMemoryImportPackage(
  payload: Buffer
): ValidatedAccountMemoryImportPackage {
  if (
    payload.byteLength === 0 ||
    payload.byteLength > ACCOUNT_MEMORY_IMPORT_LIMITS.maxPayloadBytes
  ) {
    throwInvalidAccountMemoryPackage();
  }

  let parsed: unknown;

  try {
    const json = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(payload);
    parsed = JSON.parse(json);
  } catch {
    throwInvalidAccountMemoryPackage();
  }

  const result = accountMemoryImportPackageSchema.safeParse(parsed);

  if (!result.success) {
    throwInvalidAccountMemoryPackage();
  }

  const memories: PortableAccountMemoryRecord[] = [];
  const normalizedContents = new Set<string>();
  let intraPackageDuplicates = 0;

  for (const memory of result.data.memories) {
    const normalizedContent = normalizeAccountMemoryContent(memory.content);

    if (normalizedContents.has(normalizedContent)) {
      intraPackageDuplicates += 1;
      continue;
    }

    normalizedContents.add(normalizedContent);
    memories.push(memory);
  }

  return {
    packageDigest: computeAccountMemoryPackageDigest(payload),
    packageRecords: result.data.memories.length,
    intraPackageDuplicates,
    memories,
    warnings: result.data.warnings,
  };
}

export function computeAccountMemoryPackageDigest(payload: Buffer) {
  return createHash("sha256").update(payload).digest("hex");
}

export function normalizeAccountMemoryContent(content: string) {
  return content.trim();
}

function toPortableSource(
  source: MemorySource
): "USER_PROVIDED" | "IMPORTED" {
  return source === MemorySource.IMPORTED ? "IMPORTED" : "USER_PROVIDED";
}

function throwInvalidAccountMemoryPackage(): never {
  throw new AppError(
    "Account Memory import package is invalid or unsupported.",
    400,
    "ACCOUNT_MEMORY_IMPORT_PACKAGE_INVALID"
  );
}
