import type { InputJsonValue } from "@prisma/client/runtime/client";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ChatRole } from "../../generated/prisma/enums.js";
import { FALLBACK_AI_MODEL } from "../ai/provider-registry.js";
import type {
  ExternalChatImportMessage,
  ValidatedExternalChatImport,
} from "./external-chat-import.types.js";

const MESSAGE_INSERT_BATCH_SIZE = 500;

export interface PersistedExternalChatImport {
  chats: number;
  messages: number;
}

export interface ExternalChatImportRepository {
  createImportedChats(
    userId: string,
    packageData: ValidatedExternalChatImport
  ): Promise<PersistedExternalChatImport>;
}

export function createPrismaExternalChatImportRepository(
  database: typeof prisma = prisma,
  now: () => Date = () => new Date()
): ExternalChatImportRepository {
  return {
    async createImportedChats(userId, packageData) {
      return database.$transaction(
        async (tx) => {
          const settings = await tx.userSettings.findUnique({
            select: {
              defaultModel: true,
            },
            where: {
              userId,
            },
          });
          const localModel = settings?.defaultModel || FALLBACK_AI_MODEL;
          let messageCount = 0;

          for (const sourceChat of packageData.chats) {
            const fallbackDate = now();
            const createdAt = sourceChat.createdAt || fallbackDate;
            const messages = normalizeMessageDates(sourceChat.messages, createdAt);
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

            for (let offset = 0; offset < messages.length; offset += MESSAGE_INSERT_BATCH_SIZE) {
              const batch = messages.slice(offset, offset + MESSAGE_INSERT_BATCH_SIZE);

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
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    },
  };
}

export const externalChatImportRepository =
  createPrismaExternalChatImportRepository();

function toPrismaJson(value: unknown): InputJsonValue {
  return value as InputJsonValue;
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
