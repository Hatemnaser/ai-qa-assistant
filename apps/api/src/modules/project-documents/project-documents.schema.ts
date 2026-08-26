import { z } from "zod";

import {
  PROJECT_DOCUMENT_IMPORT_POLICY,
  isSupportedProjectDocumentFile,
} from "./project-document-files.js";

export const projectDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(50000),
  mimeType: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((value) => value || null),
});

const projectDocumentInlineImportFileSchema = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_DOCUMENT_IMPORT_POLICY.maxNameChars),
    content: z.string().min(1).max(PROJECT_DOCUMENT_IMPORT_POLICY.maxFileBytes),
    mimeType: z.string().trim().max(120).default(""),
    sizeBytes: z.number().int().min(1).max(PROJECT_DOCUMENT_IMPORT_POLICY.maxFileBytes),
  })
  .superRefine((file, context) => {
    if (!isSupportedProjectDocumentFile(file.name, file.mimeType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported file type. Please use ${PROJECT_DOCUMENT_IMPORT_POLICY.supportedTypesLabel}.`,
        path: ["mimeType"],
      });
    }

    if (Buffer.byteLength(file.content, "utf8") > PROJECT_DOCUMENT_IMPORT_POLICY.maxFileBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "File content must be 250KB or smaller.",
        path: ["content"],
      });
    }
  });

const projectDocumentStoredImportFileSchema = z.union([
  z.object({
    sourceAssetId: z.string().trim().min(1).max(191),
  }),
  // Temporary alias for clients that use the generic StoredAsset field name.
  z.object({
    assetId: z.string().trim().min(1).max(191),
  }).transform((value) => ({ sourceAssetId: value.assetId })),
]);

const projectDocumentImportFileSchema = z.union([
  projectDocumentStoredImportFileSchema,
  projectDocumentInlineImportFileSchema,
]);

export const projectDocumentImportInputSchema = z.object({
  files: z
    .array(projectDocumentImportFileSchema)
    .min(1, "Select at least one project file.")
    .max(
      PROJECT_DOCUMENT_IMPORT_POLICY.maxFiles,
      `You can import up to ${PROJECT_DOCUMENT_IMPORT_POLICY.maxFiles} files at a time.`
    ),
}).superRefine((input, context) => {
  const sourceAssetIds = input.files
    .filter((file): file is { sourceAssetId: string } => "sourceAssetId" in file)
    .map((file) => file.sourceAssetId);

  if (new Set(sourceAssetIds).size !== sourceAssetIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each project document source asset may only be imported once.",
      path: ["files"],
    });
  }
});
