import { z } from "zod";

import { env } from "../../config/env.js";
import {
  CHAT_ATTACHMENT_LIMITS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
  isSupportedImageMimeType,
  isSupportedTextAttachment,
} from "./chat.attachments.js";

export const QA_CHAT_MODES = [
  "general",
  "test_cases",
  "bug_report",
  "edge_cases",
  "checklist",
  "screenshot_review",
] as const;

export const chatHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).optional(),
  content: z.string().max(env.maxMessageChars),
  mode: z.string().trim().max(32).optional(),
  model: z.string().trim().max(191).optional(),
});

export const chatImageSchema = z.object({
  mimeType: z.string().min(1).refine(isSupportedImageMimeType, {
    message: "Unsupported image type. Please use PNG, JPG, JPEG, or WEBP.",
  }),
  data: z
    .string()
    .min(1)
    .max(
      MAX_INLINE_IMAGE_BASE64_CHARS,
      "Image data must be 4MB or smaller before encoding."
    ),
});

export const chatImageAttachmentSchema = chatImageSchema.extend({
  type: z.literal("image"),
  name: z.string().trim().max(CHAT_ATTACHMENT_LIMITS.maxNameChars).optional(),
});

export const chatFileAttachmentSchema = z.object({
  type: z.literal("file"),
  name: z.string().trim().max(CHAT_ATTACHMENT_LIMITS.maxNameChars).optional(),
  mimeType: z.string().min(1),
  content: z
    .string()
    .min(1)
    .max(CHAT_ATTACHMENT_LIMITS.maxTextContentChars, "File content must be 1MB or smaller."),
}).superRefine((attachment, context) => {
  if (isSupportedTextAttachment(attachment.name, attachment.mimeType)) return;

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Unsupported file type. Please use TXT, Markdown, LOG, CSV, or JSON.",
    path: ["mimeType"],
  });
});

export const chatStoredAttachmentSchema = z.object({
  assetId: z.string().trim().min(1).max(191),
});

export const chatAttachmentSchema = z.union([
  chatImageAttachmentSchema,
  chatFileAttachmentSchema,
  chatStoredAttachmentSchema,
]);

export const chatRequestSchema = z.object({
  chatId: z.preprocess(normalizeOptionalString, z.string().min(1).max(191).optional()),
  message: z
    .string()
    .trim()
    .min(1, "Message is required and must be a string.")
    .max(env.maxMessageChars, `Message must be ${env.maxMessageChars} characters or fewer.`),
  mode: z.enum(QA_CHAT_MODES).default("general"),
  model: z.string().trim().min(1).max(191).optional(),
  provider: z.enum(["gemini"]).optional(),
  projectId: z.preprocess(normalizeOptionalString, z.string().min(1).max(191).optional()),
  history: z.array(chatHistoryMessageSchema).max(env.maxHistoryMessages).default([]),
  attachments: z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .array(chatAttachmentSchema)
      .max(
        CHAT_ATTACHMENT_LIMITS.maxAttachments,
        `You can attach up to ${CHAT_ATTACHMENT_LIMITS.maxAttachments} files per message.`
      )
      .optional()
  ),
  image: z.preprocess((value) => (value === null ? undefined : value), chatImageSchema.optional()),
}).superRefine((input, context) => {
  const historyChars = input.history.reduce((total, message) => total + message.content.length, 0);

  if (historyChars > env.maxHistoryTotalChars) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Chat history must be ${env.maxHistoryTotalChars} characters or fewer.`,
      path: ["history"],
    });
  }

  const storedAssetIds = (input.attachments || [])
    .filter((attachment): attachment is { assetId: string } => "assetId" in attachment)
    .map((attachment) => attachment.assetId);

  if (new Set(storedAssetIds).size !== storedAssetIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each stored attachment may only be included once.",
      path: ["attachments"],
    });
  }
});

function normalizeOptionalString(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();

  return trimmed || undefined;
}
