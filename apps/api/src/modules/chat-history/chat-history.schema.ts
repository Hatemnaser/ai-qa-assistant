import { z } from "zod";

const chatAttachmentSchema = z.object({
  type: z.enum(["image", "file"]),
  name: z.string().min(1),
  mimeType: z.string(),
  previewUrl: z.string().optional(),
});

const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  mode: z.string().default("general"),
  model: z.string().default("gemini-2.5-flash"),
  attachment: chatAttachmentSchema.optional(),
  attachments: z.array(chatAttachmentSchema).max(4).optional(),
  createdAt: z.string().datetime().optional(),
  isError: z.boolean().optional(),
});

export const storedChatSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120).default("New QA Chat"),
  mode: z.string().default("general"),
  model: z.string().default("gemini-2.5-flash"),
  messages: z.array(chatMessageSchema).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const saveStoredChatRequestSchema = z.object({
  chat: storedChatSchema,
});
