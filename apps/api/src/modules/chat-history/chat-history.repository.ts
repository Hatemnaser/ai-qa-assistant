import type { InputJsonValue } from "@prisma/client/runtime/client";

import { prisma } from "../../db/prisma.js";
import { ChatRole } from "../../generated/prisma/enums.js";
import type { StoredChatInput } from "./chat-history.types.js";

export interface StoredMessageRecord {
  id: string;
  role: (typeof ChatRole)[keyof typeof ChatRole];
  content: string;
  mode: string;
  model: string | null;
  attachment: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface StoredChatRecord {
  id: string;
  projectId: string | null;
  title: string;
  mode: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
  messages: StoredMessageRecord[];
}

export interface SaveUserChatInput {
  chat: StoredChatInput;
  createdAt: Date;
  messages: Array<{
    id: string;
    role: (typeof ChatRole)[keyof typeof ChatRole];
    content: string;
    mode: string;
    model: string;
    attachment?: unknown;
    metadata?: unknown;
    createdAt: Date;
  }>;
  updatedAt: Date;
  userId: string;
}

export interface ChatHistoryRepository {
  deleteUserChat(userId: string, chatId: string): Promise<number>;
  findChatOwner(chatId: string): Promise<{ userId: string } | null>;
  findProjectOwner(projectId: string): Promise<{ ownerId: string } | null>;
  listUserChats(userId: string): Promise<StoredChatRecord[]>;
  saveUserChat(input: SaveUserChatInput): Promise<StoredChatRecord>;
}

export function createPrismaChatHistoryRepository(): ChatHistoryRepository {
  return {
    async deleteUserChat(userId, chatId) {
      const result = await prisma.chat.deleteMany({
        where: {
          id: chatId,
          userId,
        },
      });

      return result.count;
    },

    async findChatOwner(chatId) {
      return prisma.chat.findUnique({
        select: {
          userId: true,
        },
        where: {
          id: chatId,
        },
      });
    },

    async findProjectOwner(projectId) {
      return prisma.project.findUnique({
        select: {
          ownerId: true,
        },
        where: {
          id: projectId,
        },
      });
    },

    async listUserChats(userId) {
      return prisma.chat.findMany({
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          userId,
        },
      });
    },

    async saveUserChat(input) {
      return prisma.$transaction(async (tx) => {
        const chatData = {
          mode: input.chat.mode,
          model: input.chat.model,
          projectId: input.chat.projectId,
          title: input.chat.title,
          updatedAt: input.updatedAt,
        };

        await tx.chat.upsert({
          create: {
            ...chatData,
            id: input.chat.id,
            createdAt: input.createdAt,
            userId: input.userId,
          },
          update: chatData,
          where: {
            id: input.chat.id,
          },
        });

        await tx.message.deleteMany({
          where: {
            chatId: input.chat.id,
          },
        });

        if (input.messages.length > 0) {
          await tx.message.createMany({
            data: input.messages.map((message) => ({
              attachment: toPrismaJson(message.attachment),
              chatId: input.chat.id,
              content: message.content,
              createdAt: message.createdAt,
              id: message.id,
              metadata: toPrismaJson(message.metadata),
              mode: message.mode,
              model: message.model,
              role: message.role,
            })),
          });
        }

        return tx.chat.findFirstOrThrow({
          include: {
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          where: {
            id: input.chat.id,
            userId: input.userId,
          },
        });
      });
    },
  };
}

export const chatHistoryRepository = createPrismaChatHistoryRepository();

function toPrismaJson(value: unknown): InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as InputJsonValue);
}
