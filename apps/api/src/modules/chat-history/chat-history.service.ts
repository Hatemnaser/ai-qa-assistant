import { ChatRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { chatHistoryRepository } from "./chat-history.repository.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import {
  RECENT_COMPLETE_TURN_LIMIT,
  selectRecentCompleteTurns,
} from "./chat-turns.js";
import type {
  ChatHistoryRepository,
  StoredChatDto,
  StoredChatInput,
  StoredChatMessageDto,
  StoredChatRecord,
  StoredMessageRecord,
} from "./chat-history.types.js";

export { RECENT_COMPLETE_TURN_LIMIT, selectRecentCompleteTurns };

export interface ChatHistoryServiceDependencies {
  isPrivateAssetsEnabled?: () => boolean;
  now?: () => Date;
  projectAccess: ProjectAccessService;
  repository: ChatHistoryRepository;
}

export function createChatHistoryService({
  isPrivateAssetsEnabled = () => true,
  now = () => new Date(),
  projectAccess,
  repository,
}: ChatHistoryServiceDependencies) {
  async function listUserChats(userId: string): Promise<StoredChatDto[]> {
    const chats = await repository.listUserChats(userId);

    return chats.map(toStoredChatDto);
  }

  async function loadRecentCompleteTurns(userId: string, chatId: string) {
    const chat = await repository.findChatByIdAndUserId(chatId, userId);

    if (!chat) return undefined;

    return selectRecentCompleteTurns(sortMessagesChronologically(chat.messages));
  }

  async function saveUserChat(userId: string, input: StoredChatInput): Promise<StoredChatDto> {
    const existingChat = await repository.findChatOwner(input.id);
    const projectId = input.projectId || null;

    if (existingChat && existingChat.userId !== userId) {
      throw new AppError("Chat was not found.", 404, "CHAT_NOT_FOUND");
    }

    if (projectId) {
      await projectAccess.assertProjectAccess(userId, projectId);
    }

    const fallbackDate = now();
    const savedChat = await repository.saveUserChat({
      chat: {
        ...input,
        projectId,
      },
      createdAt: toDate(input.createdAt, fallbackDate),
      messages: input.messages.map((message) => {
        const attachments = toPersistenceAttachments(message);

        if (attachments.assetAttachments.length > 0 && !isPrivateAssetsEnabled()) {
          throw new AppError(
            "Private asset storage is unavailable.",
            503,
            "ASSET_STORAGE_DISABLED"
          );
        }

        return {
          id: message.id,
          ...(attachments.legacyAttachments.length > 0
            ? { attachment: attachments.legacyAttachments }
            : {}),
          assetAttachments: attachments.assetAttachments,
          content: message.content,
          createdAt: toDate(message.createdAt, fallbackDate),
          metadata: message.isError ? { isError: true } : undefined,
          mode: message.mode,
          model: message.model,
          role: toPrismaChatRole(message.role),
        };
      }),
      updatedAt: toDate(input.updatedAt, fallbackDate),
      userId,
    });

    return toStoredChatDto(savedChat);
  }

  async function deleteUserChat(userId: string, chatId: string) {
    const deletedCount = await repository.deleteUserChat(userId, chatId);

    if (deletedCount === 0) {
      throw new AppError("Chat was not found.", 404, "CHAT_NOT_FOUND");
    }
  }

  return {
    deleteUserChat,
    listUserChats,
    loadRecentCompleteTurns,
    saveUserChat,
  };
}

function toStoredChatDto(chat: StoredChatRecord): StoredChatDto {
  return {
    id: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    mode: chat.mode,
    model: chat.model,
    messages: sortMessagesChronologically(chat.messages).map(toStoredMessageDto),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

function toStoredMessageDto(message: StoredMessageRecord): StoredChatMessageDto {
  const attachments = toDtoAttachments(message);

  return {
    id: message.id,
    role: message.role === ChatRole.ASSISTANT ? "assistant" : "user",
    content: message.content,
    mode: message.mode,
    model: message.model || "gemini-2.5-flash",
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt: message.createdAt.toISOString(),
    ...(hasErrorFlag(message.metadata) ? { isError: true } : {}),
  };
}

function sortMessagesChronologically(messages: StoredMessageRecord[]) {
  return [...messages].sort(
    (first, second) =>
      first.createdAt.getTime() - second.createdAt.getTime() ||
      first.id.localeCompare(second.id)
  );
}

function toLegacyAttachments(message: { attachment?: unknown }) {
  const attachment = message.attachment;
  const attachments = Array.isArray(attachment)
    ? attachment
    : attachment
      ? [attachment]
      : [];

  return attachments.filter(isAttachmentRecord).map((value) => ({
    type: value.type === "image" ? ("image" as const) : ("file" as const),
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Attachment",
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
  }));
}

function toPersistenceAttachments(message: { attachment?: unknown; attachments?: unknown[] }) {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : Array.isArray(message.attachment)
      ? message.attachment
      : message.attachment
        ? [message.attachment]
        : [];

  const assetAttachments: Array<{ assetId: string; ordinal: number }> = [];
  const legacyAttachments: Array<{ type: "image" | "file"; name: string; mimeType: string }> = [];

  attachments.filter(isAttachmentRecord).forEach((attachment, ordinal) => {
    if (typeof attachment.assetId === "string" && attachment.assetId.trim()) {
      assetAttachments.push({ assetId: attachment.assetId.trim(), ordinal });
      return;
    }

    legacyAttachments.push({
      type: attachment.type === "image" ? "image" : "file",
      name: typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : "Attachment",
      mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : "",
    });
  });

  return { assetAttachments, legacyAttachments };
}

function toDtoAttachments(message: StoredMessageRecord) {
  const stored = (message.attachments || [])
    .slice()
    .sort((first, second) => first.ordinal - second.ordinal)
    .map((attachment) => {
      const mimeType = attachment.asset.detectedMimeType || attachment.asset.declaredMimeType;

      return {
        assetId: attachment.asset.id,
        type: mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
        name: attachment.asset.originalName,
        mimeType,
      };
    });

  return [...stored, ...toLegacyAttachments(message)];
}

function isAttachmentRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toPrismaChatRole(role: "user" | "assistant") {
  return role === "assistant" ? ChatRole.ASSISTANT : ChatRole.USER;
}

function hasErrorFlag(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "isError" in metadata &&
      (metadata as { isError?: unknown }).isError
  );
}

function toDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? fallback : date;
}

export const chatHistoryService = createChatHistoryService({
  isPrivateAssetsEnabled: () => env.privateAssetsEnabled,
  projectAccess: projectAccessService,
  repository: chatHistoryRepository,
});
