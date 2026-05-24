import { z } from "zod";

import { env } from "../../config/env.js";

export const chatHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).optional(),
  content: z.string(),
  mode: z.string().optional(),
  model: z.string().optional(),
});

export const chatImageSchema = z.object({
  mimeType: z.string().min(1),
  data: z.string().min(1),
});

export const chatImageAttachmentSchema = chatImageSchema.extend({
  type: z.literal("image"),
  name: z.string().trim().max(255).optional(),
});

export const chatFileAttachmentSchema = z.object({
  type: z.literal("file"),
  name: z.string().trim().max(255).optional(),
  mimeType: z.string().min(1),
  content: z.string().min(1).max(1_000_000, "File content must be 1MB or smaller."),
});

export const chatAttachmentSchema = z.discriminatedUnion("type", [
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
  history: z.array(chatHistoryMessageSchema).max(env.maxHistoryMessages).default([]),
  attachments: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.array(chatAttachmentSchema).max(4, "You can attach up to 4 files per message.").optional()
  ),
  image: z.preprocess((value) => (value === null ? undefined : value), chatImageSchema.optional()),
});
