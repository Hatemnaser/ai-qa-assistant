import { z } from "zod";

import { env } from "../../config/env.js";
import {
  CHAT_ATTACHMENT_LIMITS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
  isSupportedImageMimeType,
  isSupportedTextAttachment,
} from "./chat.attachments.js";

export const chatHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).optional(),
  content: z.string(),
  mode: z.string().optional(),
  model: z.string().optional(),
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

export const chatAttachmentSchema = z.union([
  chatImageAttachmentSchema,
  chatFileAttachmentSchema,
]);

export const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message is required and must be a string.")
    .max(env.maxMessageChars, `Message must be ${env.maxMessageChars} characters or fewer.`),
  mode: z.string().default("general"),
  model: z.string().trim().optional(),
  provider: z.string().trim().optional(),
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
});

function normalizeOptionalString(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();

  return trimmed || undefined;
}
