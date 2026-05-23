import { ChatRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import {
  chatHistoryRepository,
  type ChatHistoryRepository,
  type StoredChatRecord,
  type StoredMessageRecord,
} from "./chat-history.repository.js";
import type { StoredChatDto, StoredChatInput, StoredChatMessageDto } from "./chat-history.types.js";

export interface ChatHistoryServiceDependencies {
  now?: () => Date;
  repository: ChatHistoryRepository;
}

export function createChatHistoryService({ now = () => new Date(), repository }: ChatHistoryServiceDependencies) {
  async function listUserChats(userId: string): Promise<StoredChatDto[]> {
    const chats = await repository.listUserChats(userId);

    return chats.map(toStoredChatDto);
  }

  async function saveUserChat(userId: string, input: StoredChatInput): Promise<StoredChatDto> {
    const existingChat = await repository.findChatOwner(input.id);

    if (existingChat && existingChat.userId !== userId) {
      throw new AppError("Chat was not found.", 404, "CHAT_NOT_FOUND");
    }

    const fallbackDate = now();
    const savedChat = await repository.saveUserChat({
      chat: input,
      createdAt: toDate(input.createdAt, fallbackDate),
      messages: input.messages.map((message) => ({
        id: message.id,
        attachment: message.attachment,
        content: message.content,
        createdAt: toDate(message.createdAt, fallbackDate),
        metadata: message.isError ? { isError: true } : undefined,
        mode: message.mode,
        model: message.model,
        role: toPrismaChatRole(message.role),
      })),
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
    saveUserChat,
  };
}

function toStoredChatDto(chat: StoredChatRecord): StoredChatDto {
  return {
    id: chat.id,
    title: chat.title,
    mode: chat.mode,
    model: chat.model,
    messages: chat.messages.map(toStoredMessageDto),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

function toStoredMessageDto(message: StoredMessageRecord): StoredChatMessageDto {
  return {
    id: message.id,
    role: message.role === ChatRole.ASSISTANT ? "assistant" : "user",
    content: message.content,
    mode: message.mode,
    model: message.model || "gemini-2.5-flash",
    ...(message.attachment ? { attachment: message.attachment } : {}),
    createdAt: message.createdAt.toISOString(),
    ...(hasErrorFlag(message.metadata) ? { isError: true } : {}),
  };
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
  repository: chatHistoryRepository,
});
