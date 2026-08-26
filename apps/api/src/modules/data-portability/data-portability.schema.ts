import { z } from "zod";

import { CHAT_ATTACHMENT_LIMITS } from "../chat/chat.attachments.js";
import { BINARY_ASSET_PORTABILITY_LIMITS } from "./binary-assets.js";
import {
  PROJECT_EXPORT_FORMAT_VERSION,
  PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
  PROJECT_IMPORT_LIMITS,
} from "./data-portability.types.js";

export const projectExportQuerySchema = z.object({
  includeChats: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
});

export const projectImportDigestSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i)
  .transform((value) => value.toLowerCase());

const portableTimestampSchema = z.string().max(64).datetime();
const portableFileReferenceSchema = z.object({
  path: z.string().min(1).max(PROJECT_IMPORT_LIMITS.maxPathChars),
  encoding: z.literal("utf-8"),
}).strict();

const manifestFileSchema = z.object({
  path: z.string().min(1).max(PROJECT_IMPORT_LIMITS.maxPathChars),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
}).strict();
const manifestCommonShape = {
  exportType: z.literal("project"),
  exportedAt: portableTimestampSchema,
  projectId: z.string().min(1).max(240),
  projectName: z.string().trim().min(1).max(120),
  warnings: z.array(z.string().max(1000)).max(1000),
  files: z.array(manifestFileSchema).max(PROJECT_IMPORT_LIMITS.maxEntries),
} as const;

const projectExportManifestV1Schema = z.object({
  ...manifestCommonShape,
  formatVersion: z.literal(PROJECT_EXPORT_LEGACY_FORMAT_VERSION),
  include: z.object({
    chats: z.boolean(),
    documents: z.literal(true),
    readable: z.literal(true),
  }).strict(),
  counts: z.object({
    documents: z.number().int().nonnegative(),
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const projectExportManifestV2Schema = z.object({
  ...manifestCommonShape,
  formatVersion: z.literal(PROJECT_EXPORT_FORMAT_VERSION),
  include: z.object({
    assets: z.literal(true),
    chats: z.boolean(),
    documents: z.literal(true),
    readable: z.literal(true),
  }).strict(),
  counts: z.object({
    assetBytes: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }).strict(),
  assets: z.array(z.unknown()).max(BINARY_ASSET_PORTABILITY_LIMITS.maxAssets),
}).strict();

export const projectExportManifestSchema = z.discriminatedUnion(
  "formatVersion",
  [projectExportManifestV1Schema, projectExportManifestV2Schema]
);

const portableDocumentMetadataSchema = z
  .object({
    originalName: z.string().min(1).max(255).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict()
  .nullable();

const portableProjectDocumentSchema = z.object({
  sourceId: z.string().min(1).max(240),
  title: z.string().trim().min(1).max(160),
  source: z.enum(["USER_PROVIDED", "IMPORTED"]),
  mimeType: z.string().max(120).nullable(),
  metadata: portableDocumentMetadataSchema,
  createdAt: portableTimestampSchema,
  updatedAt: portableTimestampSchema,
  file: portableFileReferenceSchema,
}).strict();

const portableProjectChatReferenceSchema = z.object({
  sourceId: z.string().min(1).max(240),
  title: z.string().trim().min(1).max(120),
  dataPath: z.string().min(1).max(PROJECT_IMPORT_LIMITS.maxPathChars),
  readablePath: z.string().min(1).max(PROJECT_IMPORT_LIMITS.maxPathChars),
  createdAt: portableTimestampSchema,
  updatedAt: portableTimestampSchema,
  messageCount: z.number().int().nonnegative(),
}).strict();

export const portableProjectSchema = z.object({
  formatVersion: z.enum([
    PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
    PROJECT_EXPORT_FORMAT_VERSION,
  ]),
  exportType: z.literal("project"),
  project: z.object({
    sourceId: z.string().min(1).max(240),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(1000).nullable(),
    createdAt: portableTimestampSchema,
    updatedAt: portableTimestampSchema,
    instructions: z
      .object({
        content: z.string().max(12000).refine((value) => value.trim().length > 0),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
      })
      .strict()
      .nullable(),
    memory: z
      .object({
        content: z.string().max(6000).refine((value) => value.trim().length > 0),
        source: z.enum(["USER_PROVIDED", "AI_EXTRACTED", "CHAT_SUMMARY", "IMPORTED"]),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
      })
      .strict()
      .nullable(),
    documents: z
      .array(portableProjectDocumentSchema)
      .max(PROJECT_IMPORT_LIMITS.maxDocuments),
    chats: z
      .array(portableProjectChatReferenceSchema)
      .max(PROJECT_IMPORT_LIMITS.maxChats),
  }).strict(),
}).strict();

const portableAttachmentSchema = z.object({
  type: z.enum(["image", "file"]),
  name: z.string().trim().min(1).max(CHAT_ATTACHMENT_LIMITS.maxNameChars),
  mimeType: z.string().max(120),
}).strict();

const portableChatMessageSchema = z.object({
  sourceId: z.string().min(1).max(240),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(PROJECT_IMPORT_LIMITS.maxMessageChars),
  mode: z.string().min(1).max(120),
  model: z.string().max(120).nullable(),
  createdAt: portableTimestampSchema,
  attachments: z
    .array(portableAttachmentSchema)
    .max(CHAT_ATTACHMENT_LIMITS.maxAttachments)
    .optional(),
  isError: z.boolean().optional(),
}).strict();

export const portableProjectChatSchema = z.object({
  formatVersion: z.enum([
    PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
    PROJECT_EXPORT_FORMAT_VERSION,
  ]),
  exportType: z.literal("project_chat"),
  projectId: z.string().min(1).max(240),
  chat: z.object({
    sourceId: z.string().min(1).max(240),
    title: z.string().trim().min(1).max(120),
    mode: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
    createdAt: portableTimestampSchema,
    updatedAt: portableTimestampSchema,
    messages: z
      .array(portableChatMessageSchema)
      .max(PROJECT_IMPORT_LIMITS.maxMessagesPerChat),
  }).strict(),
}).strict();
