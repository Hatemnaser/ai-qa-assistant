import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import type { ChatHistoryRepository } from "./chat-history.types.js";

export function createPrismaChatHistoryRepository(database: typeof prisma = prisma): ChatHistoryRepository {
  return {
    async deleteUserChat(userId, chatId) {
      return database.$transaction(async (tx) => {
        await lockChat(tx, chatId);
        const chat = await tx.chat.findFirst({
          select: {
            messages: {
              select: {
                attachments: {
                  select: {
                    asset: { select: { objectKey: true, uploadExpiresAt: true } },
                  },
                },
              },
            },
          },
          where: { id: chatId, userId },
        });

        if (!chat) return 0;

        const assets = chat.messages.flatMap((message) =>
          message.attachments.map((attachment) => attachment.asset)
        );
        const objectKeys = assets.map((asset) => asset.objectKey);
        await enqueueAssetDeletionJobs(tx, assets);

        if (objectKeys.length > 0) {
          await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING" },
            where: { objectKey: { in: objectKeys } },
          });
        }

        const result = await tx.chat.deleteMany({
          where: { id: chatId, userId },
        });

        return result.count;
      });
    },

    async findChatOwner(chatId) {
      return database.chat.findUnique({
        select: {
          userId: true,
        },
        where: {
          id: chatId,
        },
      });
    },

    async findChatByIdAndUserId(chatId, userId) {
      return database.chat.findFirst({
        include: {
          messages: {
            include: messageAttachmentInclude,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: DATA_LIMITS.messagesPerChat,
          },
        },
        where: {
          id: chatId,
          userId,
        },
      });
    },

    async listUserChats(userId) {
      return database.chat.findMany({
        include: {
          messages: {
            include: messageAttachmentInclude,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: DATA_LIMITS.messagesPerChat,
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: DATA_LIMITS.chatsPerUser,
        where: {
          userId,
        },
      });
    },

    async saveUserChat(input) {
      return database.$transaction(async (tx) => {
        await lockChat(tx, input.chat.id);
        const chatData = {
          mode: input.chat.mode,
          model: input.chat.model,
          projectId: input.chat.projectId,
          title: input.chat.title,
          updatedAt: input.updatedAt,
        };

        const existingChat = await tx.chat.findUnique({
          select: { userId: true },
          where: { id: input.chat.id },
        });
        if (existingChat && existingChat.userId !== input.userId) {
          throw new AppError("Chat was not found.", 404, "CHAT_NOT_FOUND");
        }

        if (!existingChat) {
          await lockUserChatQuota(tx, input.userId);
          const chatCount = await tx.chat.count({ where: { userId: input.userId } });

          if (chatCount >= DATA_LIMITS.chatsPerUser) {
            throw new AppError(
              `You can save up to ${DATA_LIMITS.chatsPerUser} chats. Delete one before creating another.`,
              409,
              "CHAT_LIMIT_REACHED"
            );
          }
        }

        if (input.messages.length > DATA_LIMITS.messagesPerChat) {
          throw new AppError(
            `A chat can contain up to ${DATA_LIMITS.messagesPerChat} messages.`,
            409,
            "CHAT_MESSAGE_LIMIT_REACHED"
          );
        }

        const contentBytes = input.messages.reduce(
          (total, message) => total + Buffer.byteLength(message.content, "utf8"),
          0
        );
        if (
          input.messages.some(
            (message) => message.content.length > DATA_LIMITS.chatMessageContentChars
          ) ||
          contentBytes > DATA_LIMITS.chatMessageContentBytesPerChat
        ) {
          throw new AppError(
            "Chat message content exceeds the saved-chat size limit.",
            409,
            "CHAT_SIZE_LIMIT_REACHED"
          );
        }

        if (existingChat) {
          await tx.chat.update({ data: chatData, where: { id: input.chat.id } });
        } else {
          await tx.chat.create({
            data: {
              ...chatData,
              id: input.chat.id,
              createdAt: input.createdAt,
              userId: input.userId,
            },
          });
        }

        const messageIds = input.messages.map((message) => message.id);
        if (messageIds.length > 0) {
          const conflictingMessage = await tx.message.findFirst({
            select: { id: true },
            where: {
              chatId: { not: input.chat.id },
              id: { in: messageIds },
            },
          });
          if (conflictingMessage) {
            throw new AppError("Chat message id is already in use.", 409, "CHAT_MESSAGE_CONFLICT");
          }
        }

        const requestedAssetLinks = input.messages.flatMap((message) =>
          message.assetAttachments.map((attachment) => ({
            ...attachment,
            messageId: message.id,
          }))
        );
        const requestedAssetIds = requestedAssetLinks.map((attachment) => attachment.assetId);
        if (new Set(requestedAssetIds).size !== requestedAssetIds.length) {
          throw new AppError(
            "Each stored attachment may only be referenced once in a chat.",
            400,
            "ASSET_DUPLICATE_REFERENCE"
          );
        }

        if (requestedAssetIds.length > 0) {
          for (const assetId of [...new Set(requestedAssetIds)].sort()) {
            await lockAsset(tx, assetId);
          }
          const availableAssets = await tx.storedAsset.findMany({
            select: {
              id: true,
              messageAttachment: {
                select: { message: { select: { chatId: true } }, messageId: true },
              },
              ownerId: true,
              projectId: true,
              purpose: true,
              status: true,
            },
            where: { id: { in: requestedAssetIds } },
          });
          const availableById = new Map(availableAssets.map((asset) => [asset.id, asset]));

          for (const link of requestedAssetLinks) {
            const asset = availableById.get(link.assetId);
            if (
              !asset ||
              asset.ownerId !== input.userId ||
              asset.projectId !== input.chat.projectId ||
              asset.purpose !== "CHAT_ATTACHMENT" ||
              asset.status !== "READY"
            ) {
              throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
            }
            if (
              asset.messageAttachment &&
              asset.messageAttachment.message.chatId !== input.chat.id
            ) {
              throw new AppError(
                "Stored attachment is already linked to another message.",
                409,
                "ASSET_ALREADY_ATTACHED"
              );
            }
          }
        }

        const replacedAttachments = await tx.messageAttachment.findMany({
          select: {
            assetId: true,
            asset: { select: { objectKey: true, uploadExpiresAt: true } },
          },
          where: {
            message: { chatId: input.chat.id },
          },
        });
        const requestedAssetSet = new Set(requestedAssetIds);
        const orphanedAttachments = replacedAttachments.filter(
          (attachment) => !requestedAssetSet.has(attachment.assetId)
        );

        for (const message of input.messages) {
          const messageData = {
              attachment: toPrismaJson(message.attachment),
              chatId: input.chat.id,
              content: message.content,
              createdAt: message.createdAt,
              id: message.id,
              metadata: toPrismaJson(message.metadata),
              mode: message.mode,
              model: message.model,
              role: message.role,
          };
          await tx.message.upsert({
            create: messageData,
            update: {
              attachment: messageData.attachment,
              content: messageData.content,
              createdAt: messageData.createdAt,
              metadata: messageData.metadata,
              mode: messageData.mode,
              model: messageData.model,
              role: messageData.role,
            },
            where: { id: message.id },
          });
        }

        await tx.message.deleteMany({
          where: {
            chatId: input.chat.id,
            ...(messageIds.length > 0 ? { id: { notIn: messageIds } } : {}),
          },
        });

        // Message rows stay stable. Attachment links are a replaceable
        // normalized snapshot, while only assets removed from the entire chat
        // become deletion candidates.
        await tx.messageAttachment.deleteMany({
          where: { message: { chatId: input.chat.id } },
        });
        if (requestedAssetLinks.length > 0) {
          await tx.messageAttachment.createMany({
            data: requestedAssetLinks.map((attachment) => ({
              assetId: attachment.assetId,
              messageId: attachment.messageId,
              ordinal: attachment.ordinal,
            })),
          });
        }

        const orphanedAssets = orphanedAttachments.map((attachment) => attachment.asset);
        const orphanedObjectKeys = orphanedAssets.map((asset) => asset.objectKey);
        await enqueueAssetDeletionJobs(tx, orphanedAssets);
        if (orphanedObjectKeys.length > 0) {
          await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING" },
            where: {
              messageAttachment: null,
              objectKey: { in: orphanedObjectKeys },
              ownerId: input.userId,
              status: "READY",
            },
          });
        }

        return tx.chat.findFirstOrThrow({
          include: {
            messages: {
              include: messageAttachmentInclude,
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

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

async function lockChat(tx: Prisma.TransactionClient, chatId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:chat:${chatId}`}, 0))`;
}

async function lockUserChatQuota(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
}

async function lockAsset(tx: Prisma.TransactionClient, assetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
}

const messageAttachmentInclude = {
  attachments: {
    include: {
      asset: {
        select: {
          declaredMimeType: true,
          detectedMimeType: true,
          id: true,
          originalName: true,
          sizeBytes: true,
        },
      },
    },
    orderBy: { ordinal: "asc" as const },
  },
};
