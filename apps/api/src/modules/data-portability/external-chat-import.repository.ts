import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ChatRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import { FALLBACK_AI_MODEL } from "../ai/provider-registry.js";
import type {
  ExternalChatImportRepository,
  ExternalChatImportMessage,
  ValidatedExternalChatImport,
} from "./external-chat-import.types.js";
import {
  PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS,
  withSerializableTransactionRetry,
} from "./portability-transaction.js";

const MESSAGE_INSERT_BATCH_SIZE = 500;

export function createPrismaExternalChatImportRepository(
  database: typeof prisma = prisma,
  now: () => Date = () => new Date()
): ExternalChatImportRepository {
  return {
    async createImportedChats(userId, packageData) {
      return withSerializableTransactionRetry(() =>
        database.$transaction(
          async (tx) => {
            await lockExternalChatImportQuota(tx, userId);
            const [settings, existingChatCount] = await Promise.all([
              tx.userSettings.findUnique({
                select: {
                  defaultModel: true,
                },
                where: {
                  userId,
                },
              }),
              tx.chat.count({ where: { userId } }),
            ]);
            if (
              existingChatCount + packageData.chats.length >
                DATA_LIMITS.chatsPerUser ||
              packageData.chats.some(
                (chat) =>
                  chat.messages.length > DATA_LIMITS.messagesPerChat ||
                  chat.messages.some(
                    (message) =>
                      message.content.length > DATA_LIMITS.chatMessageContentChars
                  ) ||
                  chat.messages.reduce(
                    (total, message) =>
                      total + Buffer.byteLength(message.content, "utf8"),
                    0
                  ) > DATA_LIMITS.chatMessageContentBytesPerChat
              )
            ) {
              throwImportDestinationLimitExceeded();
            }
            const localModel = settings?.defaultModel || FALLBACK_AI_MODEL;
            let messageCount = 0;

            for (const sourceChat of packageData.chats) {
              const fallbackDate = now();
              const createdAt = sourceChat.createdAt || fallbackDate;
              const messages = normalizeMessageDates(
                sourceChat.messages,
                createdAt
              );
              const lastMessageAt = messages.at(-1)?.createdAt || createdAt;
              const requestedUpdatedAt = sourceChat.updatedAt || createdAt;
              const updatedAt = new Date(
                Math.max(requestedUpdatedAt.getTime(), lastMessageAt.getTime())
              );
              const chat = await tx.chat.create({
                data: {
                  createdAt,
                  mode: "general",
                  model: localModel,
                  title: sourceChat.title,
                  updatedAt,
                  userId,
                },
              });

              for (
                let offset = 0;
                offset < messages.length;
                offset += MESSAGE_INSERT_BATCH_SIZE
              ) {
                const batch = messages.slice(
                  offset,
                  offset + MESSAGE_INSERT_BATCH_SIZE
                );

                await tx.message.createMany({
                  data: batch.map((message) => ({
                    chatId: chat.id,
                    content: message.content,
                    createdAt: message.createdAt,
                    metadata: toPrismaJson({
                      imported: {
                        provider: packageData.provider,
                        sourceConversationId: sourceChat.sourceId,
                        sourceMessageId: message.sourceId,
                        originalModel: message.originalModel,
                      },
                    }),
                    mode: "general",
                    model: localModel,
                    role:
                      message.role === "assistant"
                        ? ChatRole.ASSISTANT
                        : ChatRole.USER,
                  })),
                });
                messageCount += batch.length;
              }
            }

            return {
              chats: packageData.chats.length,
              messages: messageCount,
            };
          },
          PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS
        )
      );
    },
  };
}

export const externalChatImportRepository =
  createPrismaExternalChatImportRepository();

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeMessageDates(
  messages: ExternalChatImportMessage[],
  chatCreatedAt: Date
) {
  let previousTimestamp = chatCreatedAt.getTime() - 1;

  return messages.map((message) => {
    const sourceTimestamp = message.createdAt?.getTime();
    const createdAt = new Date(
      sourceTimestamp !== undefined && sourceTimestamp > previousTimestamp
        ? sourceTimestamp
        : previousTimestamp + 1
    );

    previousTimestamp = createdAt.getTime();

    return {
      ...message,
      createdAt,
    };
  });
}

function throwImportDestinationLimitExceeded(): never {
  throw new AppError(
    "This import would exceed an account data limit. Delete existing chats or import a smaller archive.",
    409,
    "ACCOUNT_IMPORT_DESTINATION_LIMIT_EXCEEDED"
  );
}

async function lockExternalChatImportQuota(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
}
