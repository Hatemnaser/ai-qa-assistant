import { randomUUID } from "node:crypto";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
  ProjectRole,
} from "../../generated/prisma/enums.js";
import type { ProjectDocumentRecord } from "../project-documents/project-documents.types.js";
import { BINARY_ASSET_PORTABILITY_LIMITS } from "./binary-assets.js";
import {
  assertUploadedAssetsMatchPackage,
  finalizeStagedBinaryAssets,
} from "./binary-asset-finalize.js";
import type {
  DataPortabilityRepository,
  ProjectExportChatRecord,
  ProjectExportSourceRecord,
  ValidatedProjectImportPackage,
} from "./data-portability.types.js";
import { PROJECT_EXPORT_LIMITS } from "./data-portability.types.js";
import { bindCompleteExportAssetRows } from "./export-asset-relations.js";
import { resolveImportedProjectName } from "./imported-project-name.js";
import {
  PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS,
  PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS,
  withSerializableTransactionRetry,
} from "./portability-transaction.js";

export function createPrismaDataPortabilityRepository(
  database: typeof prisma = prisma
): DataPortabilityRepository {
  return {
    async createImportedProject(userId, packageData, uploadedAssets = []) {
      assertUploadedAssetsMatchPackage(
        packageData.project.binaryAssets,
        uploadedAssets
      );

      return withSerializableTransactionRetry(() => database.$transaction(
        async (tx) => {
          await lockProjectImportQuotas(tx, userId);
          const [existingProjects, existingChatCount] = await Promise.all([
            tx.project.findMany({
              select: {
                name: true,
              },
              take: DATA_LIMITS.projectsPerUser,
              where: {
                ownerId: userId,
              },
            }),
            tx.chat.count({ where: { userId } }),
          ]);

          if (
            existingProjects.length >= DATA_LIMITS.projectsPerUser ||
            existingChatCount + packageData.project.chats.length >
              DATA_LIMITS.chatsPerUser ||
            packageData.project.documents.length >
              DATA_LIMITS.documentsPerProject ||
            packageData.project.chats.some(
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
            throwProjectImportDestinationLimitExceeded();
          }
          const projectName = resolveImportedProjectName(
            packageData.project.name,
            existingProjects.map((project) => project.name)
          );
          const project = await tx.project.create({
            data: {
              description: packageData.project.description,
              name: projectName,
              ownerId: userId,
            },
          });

          await tx.projectMember.create({
            data: {
              projectId: project.id,
              role: ProjectRole.OWNER,
              userId,
            },
          });

          if (packageData.project.instructions) {
            await tx.projectInstruction.create({
              data: {
                content: packageData.project.instructions.content,
                projectId: project.id,
              },
            });
          }

          if (packageData.project.memory) {
            await tx.projectMemory.create({
              data: {
                content: packageData.project.memory.content,
                projectId: project.id,
                source: MemorySource.IMPORTED,
              },
            });
          }

          const documents: ProjectDocumentRecord[] = [];
          const documentsBySourceId = new Map<
            string,
            { documentId: string; projectId: string }
          >();
          for (const document of packageData.project.documents) {
            const importedDocument = await tx.projectDocument.create({
              data: {
                content: document.content,
                metadata: toPrismaJson(document.metadata),
                mimeType: document.mimeType,
                projectId: project.id,
                source: ProjectDocumentSource.IMPORTED,
                title: document.title,
              },
            });
            documents.push(importedDocument);
            documentsBySourceId.set(document.sourceId, {
              documentId: importedDocument.id,
              projectId: project.id,
            });
          }

          const messagesBySourceId = new Map<
            string,
            { messageId: string; projectId: string | null }
          >();
          for (const chat of packageData.project.chats) {
            const createdChat = await tx.chat.create({
              data: {
                createdAt: chat.createdAt,
                mode: chat.mode,
                model: chat.model,
                projectId: project.id,
                title: chat.title,
                updatedAt: chat.updatedAt,
                userId,
              },
            });

            if (chat.messages.length > 0) {
              await tx.message.createMany({
                data: chat.messages.map((message) => {
                  const messageId = randomUUID();
                  messagesBySourceId.set(message.sourceId, {
                    messageId,
                    projectId: project.id,
                  });
                  return {
                    attachment:
                      message.attachments.length > 0
                        ? toPrismaJson(message.attachments)
                        : undefined,
                    chatId: createdChat.id,
                    content: message.content,
                    createdAt: message.createdAt,
                    id: messageId,
                    metadata: message.isError
                      ? toPrismaJson({
                          isError: true,
                        })
                      : undefined,
                    mode: message.mode,
                    model: message.model,
                    role: toPrismaChatRole(message.role),
                  };
                }),
              });
            }
          }

          await finalizeStagedBinaryAssets(
            tx,
            userId,
            uploadedAssets,
            { documentsBySourceId, messagesBySourceId }
          );

          return {
            projectId: project.id,
            projectName,
            documents,
            counts: {
              documents: documents.length,
              chats: packageData.project.chats.length,
              messages: packageData.project.chats.reduce(
                (total, chat) => total + chat.messages.length,
                0
              ),
              ...(uploadedAssets.length > 0
                ? { assets: uploadedAssets.length }
                : {}),
            },
          };
        },
        PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS
      ));
    },

    async findOwnedProjectExportData(userId, projectId, includeChats) {
      return database.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          instruction: {
            select: {
              content: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          projectMemory: {
            select: {
              content: true,
              source: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          documents: {
            orderBy: [
              {
                createdAt: "asc",
              },
              {
                id: "asc",
              },
            ],
            select: {
              id: true,
              title: true,
              content: true,
              source: true,
              sourceAssetId: true,
              mimeType: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
            take: PROJECT_EXPORT_LIMITS.maxDocuments + 1,
          },
        },
        where: {
          id: projectId,
          ownerId: userId,
        },
      });

      if (!project) return null;

      if (project.documents.length > PROJECT_EXPORT_LIMITS.maxDocuments) {
        throwProjectExportTooLarge();
      }

      const chatRows = includeChats
        ? await tx.chat.findMany({
            orderBy: [
              {
                createdAt: "asc",
              },
              {
                id: "asc",
              },
            ],
            select: {
              id: true,
              title: true,
              mode: true,
              model: true,
              createdAt: true,
              updatedAt: true,
            },
            take: PROJECT_EXPORT_LIMITS.maxChats + 1,
            where: {
              projectId,
              userId,
            },
          })
        : [];

      if (chatRows.length > PROJECT_EXPORT_LIMITS.maxChats) {
        throwProjectExportTooLarge();
      }

      const messageRows = includeChats
        ? await tx.message.findMany({
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              chatId: true,
              role: true,
              content: true,
              mode: true,
              model: true,
              attachment: true,
              attachments: {
                orderBy: { ordinal: "asc" },
                select: { assetId: true, ordinal: true },
              },
              metadata: true,
              createdAt: true,
            },
            take: PROJECT_EXPORT_LIMITS.maxMessages + 1,
            where: {
              chat: {
                projectId,
                userId,
              },
            },
          })
        : [];

      if (messageRows.length > PROJECT_EXPORT_LIMITS.maxMessages) {
        throwProjectExportTooLarge();
      }

      const assetRows = await tx.storedAsset.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          checksumSha256: true,
          createdAt: true,
          declaredMimeType: true,
          detectedMimeType: true,
          etag: true,
          expectedSizeBytes: true,
          id: true,
          messageAttachment: {
            select: { messageId: true, ordinal: true },
          },
          objectKey: true,
          originalName: true,
          ownerId: true,
          projectId: true,
          purpose: true,
          readyAt: true,
          sizeBytes: true,
          sourceDocument: { select: { id: true } },
          status: true,
          updatedAt: true,
          uploadExpiresAt: true,
          validationStartedAt: true,
        },
        take: BINARY_ASSET_PORTABILITY_LIMITS.maxAssets + 1,
        where: {
          OR: [
            { sourceDocument: { projectId } },
            ...(includeChats
              ? [
                  {
                    messageAttachment: {
                      message: { chat: { projectId, userId } },
                    },
                  },
                ]
              : []),
          ],
          ownerId: userId,
        },
      });
      if (assetRows.length > BINARY_ASSET_PORTABILITY_LIMITS.maxAssets) {
        throwProjectExportTooLarge();
      }

      const binaryAssets = bindCompleteExportAssetRows(
        userId,
        assetRows,
        project.documents,
        messageRows
      );

      const messagesByChat = new Map<
        string,
        ProjectExportChatRecord["messages"]
      >();
      for (const { attachments, chatId, ...message } of messageRows) {
        void attachments;
        const messages = messagesByChat.get(chatId) || [];
        messages.push(message);
        messagesByChat.set(chatId, messages);
      }
      const chats = chatRows.map((chat) => ({
        ...chat,
        messages: messagesByChat.get(chat.id) || [],
      }));
      const { documents: documentRows, ...projectRecord } = project;
      const documents = documentRows.map(({ sourceAssetId, ...document }) => {
        void sourceAssetId;
        return document;
      });

      return {
        ...projectRecord,
        binaryAssets,
        chats,
        documents,
      };
      }, PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS);
    },

    async findProjectDocumentIndexStatuses(projectId, documentIds) {
      if (documentIds.length === 0) return [];

      return database.projectDocument.findMany({
        select: {
          id: true,
          indexStatus: true,
        },
        where: {
          id: {
            in: documentIds,
          },
          projectId,
        },
      });
    },
  };
}

export const dataPortabilityRepository = createPrismaDataPortabilityRepository();

function toPrismaChatRole(role: "user" | "assistant" | "system") {
  if (role === "assistant") return ChatRole.ASSISTANT;
  if (role === "system") return ChatRole.SYSTEM;

  return ChatRole.USER;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function throwProjectExportTooLarge(): never {
  throw new AppError(
    "Project export is too large to package safely.",
    413,
    "PROJECT_EXPORT_TOO_LARGE"
  );
}

function throwProjectImportDestinationLimitExceeded(): never {
  throw new AppError(
    "This import would exceed an account data limit. Delete existing data or import a smaller archive.",
    409,
    "PROJECT_IMPORT_DESTINATION_LIMIT_EXCEEDED"
  );
}

async function lockProjectImportQuotas(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:projects:${userId}`}, 0))`;
}
