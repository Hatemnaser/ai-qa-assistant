import { z } from "zod";

import {
  ACCOUNT_MEMORY_EXPORT_TYPE,
  ACCOUNT_MEMORY_FORMAT_VERSION,
  ACCOUNT_MEMORY_IMPORT_LIMITS,
} from "./account-memory-portability.types.js";

const portableTimestampSchema = z.string().datetime();

export const accountMemoryImportDigestSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i)
  .transform((value) => value.toLowerCase());

export const portableAccountMemoryRecordSchema = z
  .object({
    sourceId: z.string().min(1).max(255),
    content: z
      .string()
      .trim()
      .min(1)
      .max(ACCOUNT_MEMORY_IMPORT_LIMITS.maxContentChars),
    source: z.enum(["USER_PROVIDED", "IMPORTED"]),
    createdAt: portableTimestampSchema.optional(),
    updatedAt: portableTimestampSchema.optional(),
  })
  .strict();

export const accountMemoryImportPackageSchema = z
  .object({
    formatVersion: z.literal(ACCOUNT_MEMORY_FORMAT_VERSION),
    exportType: z.literal(ACCOUNT_MEMORY_EXPORT_TYPE),
    exportedAt: portableTimestampSchema,
    account: z
      .object({
        sourceUserId: z.string().min(1).max(255),
      })
      .strict(),
    memories: z
      .array(portableAccountMemoryRecordSchema)
      .max(ACCOUNT_MEMORY_IMPORT_LIMITS.maxRecords),
    warnings: z.array(z.string().max(1000)).max(100),
  })
  .strict();
