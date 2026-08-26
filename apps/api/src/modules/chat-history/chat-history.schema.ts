import { z } from "zod";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { CHAT_ATTACHMENT_LIMITS } from "../chat/chat.attachments.js";

const legacyChatAttachmentSchema = z.object({
  type: z.enum(["image", "file"]),
  name: z.string().min(1).max(255),
  mimeType: z.string().max(120),
});

const storedChatAttachmentSchema = z.object({
  assetId: z.string().trim().min(1).max(191),
  // These fields are accepted during the rollout so an optimistic client can
  // render immediately. Persistence and responses always use server metadata.
  type: z.enum(["image", "file"]).optional(),
  name: z.string().min(1).max(255).optional(),
  mimeType: z.string().max(120).optional(),
});

const chatAttachmentSchema = z.union([
  storedChatAttachmentSchema,
  legacyChatAttachmentSchema,
]);

const chatMessageSchema = z.object({
  id: z.string().min(1).max(191),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(DATA_LIMITS.chatMessageContentChars),
  mode: z.string().min(1).max(64).default("general"),
  model: z.string().min(1).max(120).default("gemini-2.5-flash"),
  attachment: chatAttachmentSchema.optional(),
  attachments: z.array(chatAttachmentSchema).max(CHAT_ATTACHMENT_LIMITS.maxAttachments).optional(),
  createdAt: z.string().datetime().optional(),
  isError: z.boolean().optional(),
}).superRefine((message, context) => {
  const attachments = message.attachments || (message.attachment ? [message.attachment] : []);
  const assetIds = attachments
    .filter((attachment): attachment is { assetId: string } => "assetId" in attachment)
    .map((attachment) => attachment.assetId);

  if (new Set(assetIds).size !== assetIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each stored attachment may only be included once per message.",
      path: ["attachments"],
    });
  }
});

const chatProjectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const storedChatSchema = z.object({
  id: z.string().min(1).max(191),
  projectId: chatProjectIdSchema,
  title: z.string().trim().min(1).max(120).default("New QA Chat"),
  mode: z.string().min(1).max(64).default("general"),
  model: z.string().min(1).max(120).default("gemini-2.5-flash"),
  messages: z.array(chatMessageSchema).max(DATA_LIMITS.messagesPerChat).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).superRefine((chat, context) => {
  const messageIds = chat.messages.map((message) => message.id);

  if (new Set(messageIds).size !== messageIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each chat message id must be unique.",
      path: ["messages"],
    });
  }

  const contentBytes = chat.messages.reduce(
    (total, message) => total + Buffer.byteLength(message.content, "utf8"),
    0
  );
  if (contentBytes > DATA_LIMITS.chatMessageContentBytesPerChat) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Chat message content exceeds the saved-chat size limit.",
      path: ["messages"],
    });
  }
});

export const saveStoredChatRequestSchema = z.object({
  chat: storedChatSchema,
});
