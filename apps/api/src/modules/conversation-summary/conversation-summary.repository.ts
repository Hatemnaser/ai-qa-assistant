import { prisma } from "../../db/prisma.js";
import type { StoredMessageRecord } from "../chat-history/chat-history.repository.js";

export interface ConversationSummaryRecord {
  chatId: string;
  createdAt: Date;
  id: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  updatedAt: Date;
  userId: string;
}

export interface UpsertConversationSummaryInput {
  chatId: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  userId: string;
}

export interface ConversationSummaryGenerationState {
  messages: StoredMessageRecord[];
  summary: ConversationSummaryRecord | null;
}

export interface SaveGeneratedConversationSummaryInput
  extends UpsertConversationSummaryInput {
  expectedThroughMessageId: string | null;
}

export interface ConversationSummaryRepository {
  findByChatIdAndUserId(
    chatId: string,
    userId: string
  ): Promise<ConversationSummaryRecord | null>;
  findGenerationStateByChatIdAndUserId(
    chatId: string,
    userId: string
  ): Promise<ConversationSummaryGenerationState | null>;
  saveGeneratedIfCursorMatches(
    input: SaveGeneratedConversationSummaryInput
  ): Promise<ConversationSummaryRecord | null>;
  upsertByChatIdAndUserId(
    input: UpsertConversationSummaryInput
  ): Promise<ConversationSummaryRecord | null>;
}

export function createPrismaConversationSummaryRepository(): ConversationSummaryRepository {
  return {
    async findByChatIdAndUserId(chatId, userId) {
      return prisma.conversationSummary.findFirst({
        where: {
          chatId,
          chat: {
            userId,
          },
          userId,
        },
      });
    },

    async findGenerationStateByChatIdAndUserId(chatId, userId) {
      const chat = await prisma.chat.findFirst({
        select: {
          conversationSummary: true,
          messages: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
        where: {
          id: chatId,
          userId,
        },
      });

      if (!chat) return null;

      return {
        messages: chat.messages.map((message) => ({
          attachment: message.attachment,
          content: message.content,
          createdAt: message.createdAt,
          id: message.id,
          metadata: message.metadata,
          mode: message.mode,
          model: message.model,
          role: message.role,
        })),
        summary: chat.conversationSummary,
      };
    },

    async saveGeneratedIfCursorMatches(input) {
      return prisma.$transaction(async (tx) => {
        const chat = await tx.chat.findFirst({
          select: {
            conversationSummary: {
              select: {
                throughMessageId: true,
              },
            },
            id: true,
          },
          where: {
            id: input.chatId,
            userId: input.userId,
          },
        });

        if (
          !chat ||
          (chat.conversationSummary?.throughMessageId || null) !==
            input.expectedThroughMessageId
        ) {
          return null;
        }

        return tx.conversationSummary.upsert({
          create: {
            chatId: input.chatId,
            openQuestions: input.openQuestions,
            summary: input.summary,
            throughMessageId: input.throughMessageId,
            userId: input.userId,
          },
          update: {
            openQuestions: input.openQuestions,
            summary: input.summary,
            throughMessageId: input.throughMessageId,
          },
          where: {
            chatId: input.chatId,
          },
        });
      });
    },

    async upsertByChatIdAndUserId(input) {
      return prisma.$transaction(async (tx) => {
        const chat = await tx.chat.findFirst({
          select: {
            id: true,
          },
          where: {
            id: input.chatId,
            userId: input.userId,
          },
        });

        if (!chat) return null;

        return tx.conversationSummary.upsert({
          create: {
            chatId: input.chatId,
            openQuestions: input.openQuestions,
            summary: input.summary,
            throughMessageId: input.throughMessageId,
            userId: input.userId,
          },
          update: {
            openQuestions: input.openQuestions,
            summary: input.summary,
            throughMessageId: input.throughMessageId,
          },
          where: {
            chatId: input.chatId,
          },
        });
      });
    },
  };
}

export const conversationSummaryRepository =
  createPrismaConversationSummaryRepository();
