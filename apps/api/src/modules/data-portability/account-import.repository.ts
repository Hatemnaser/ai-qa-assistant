import { randomUUID } from "node:crypto";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import {
  ChatRole,
  MemoryScope,
  MemorySource,
  ProjectDocumentSource,
  ProjectRole,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import type { ProjectDocumentRecord } from "../project-documents/project-documents.types.js";
import {
  assertUploadedAssetsMatchPackage,
  finalizeStagedBinaryAssets,
} from "./binary-asset-finalize.js";
import type {
  AccountImportRepository,
  PersistedNativeAccountImport,
  ValidatedNativeAccountImport,
} from "./account-import.types.js";
import { resolveImportedProjectName } from "./imported-project-name.js";
import {
  PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS,
  withSerializableTransactionRetry,
} from "./portability-transaction.js";

const MESSAGE_INSERT_BATCH_SIZE = 500;

export function createPrismaAccountImportRepository(
  database: typeof prisma = prisma
): AccountImportRepository {
  return {
    async createImportedAccount(userId, packageData, uploadedAssets = []) {
      assertUploadedAssetsMatchPackage(packageData.binaryAssets, uploadedAssets);

      return withSerializableTransactionRetry(() => database.$transaction(
        async (tx) => {
          await lockAccountImportQuotas(tx, userId);
          const [existingProjects, existingMemories, existingChatCount] = await Promise.all([
            tx.project.findMany({
              select: { name: true },
              take: DATA_LIMITS.projectsPerUser + 1,
              where: { ownerId: userId },
            }),
            tx.memory.findMany({
              select: { content: true },
              take: DATA_LIMITS.accountMemoriesPerUser + 1,
              where: {
                scope: MemoryScope.USER,
                userId,
              },
            }),
            tx.chat.count({ where: { userId } }),
          ]);

          if (
            existingProjects.length + packageData.projects.length >
              DATA_LIMITS.projectsPerUser ||
            existingChatCount + packageData.chats.length > DATA_LIMITS.chatsPerUser ||
            packageData.projects.some(
              (project) =>
                project.documents.length > DATA_LIMITS.documentsPerProject
            ) ||
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
          const usedProjectNames = existingProjects.map((project) => project.name);
          const existingMemoryContent = new Set(
            existingMemories.map((memory) => normalizeMemoryContent(memory.content))
          );
          let importedMemoryCount = 0;
          let skippedAccountMemories = 0;

          for (const memory of packageData.accountMemories) {
            const normalizedContent = normalizeMemoryContent(memory.content);
            if (existingMemoryContent.has(normalizedContent)) {
              skippedAccountMemories += 1;
              continue;
            }

            if (
              existingMemories.length + importedMemoryCount >=
              DATA_LIMITS.accountMemoriesPerUser
            ) {
              throwImportDestinationLimitExceeded();
            }

            await tx.memory.create({
              data: {
                content: memory.content,
                metadata: toPrismaJson({
                  imported: {
                    archiveType: "account",
                    sourceAccountId: packageData.sourceAccountId,
                    sourceId: memory.sourceId,
                    sourceCreatedAt: memory.createdAt.toISOString(),
                    sourceUpdatedAt: memory.updatedAt.toISOString(),
                  },
                }),
                scope: MemoryScope.USER,
                source: MemorySource.IMPORTED,
                userId,
              },
            });
            existingMemoryContent.add(normalizedContent);
            importedMemoryCount += 1;
          }

          const projectIdBySourceId = new Map<string, string>();
          const documents: ProjectDocumentRecord[] = [];
          const documentsBySourceId = new Map<
            string,
            { documentId: string; projectId: string }
          >();

          for (const sourceProject of packageData.projects) {
            const projectName = resolveImportedProjectName(
              sourceProject.name,
              usedProjectNames
            );
            const project = await tx.project.create({
              data: {
                description: sourceProject.description,
                name: projectName,
                ownerId: userId,
              },
            });
            usedProjectNames.push(projectName);
            projectIdBySourceId.set(sourceProject.sourceId, project.id);

            await tx.projectMember.create({
              data: {
                projectId: project.id,
                role: ProjectRole.OWNER,
                userId,
              },
            });

            if (sourceProject.instructions) {
              await tx.projectInstruction.create({
                data: {
                  content: sourceProject.instructions.content,
                  projectId: project.id,
                },
              });
            }

            if (sourceProject.memory) {
              await tx.projectMemory.create({
                data: {
                  content: sourceProject.memory.content,
                  projectId: project.id,
                  source: MemorySource.IMPORTED,
                },
              });
            }

            for (const sourceDocument of sourceProject.documents) {
              const importedDocument = await tx.projectDocument.create({
                data: {
                  content: sourceDocument.content,
                  metadata: toPrismaJson({
                    ...(sourceDocument.metadata || {}),
                    imported: {
                      archiveType: "account",
                      sourceAccountId: packageData.sourceAccountId,
                      sourceId: sourceDocument.sourceId,
                      sourceCreatedAt: sourceDocument.createdAt.toISOString(),
                      sourceUpdatedAt: sourceDocument.updatedAt.toISOString(),
                    },
                  }),
                  mimeType: sourceDocument.mimeType,
                  projectId: project.id,
                  source: ProjectDocumentSource.IMPORTED,
                  title: sourceDocument.title,
                },
              });
              documents.push(importedDocument);
              documentsBySourceId.set(sourceDocument.sourceId, {
                documentId: importedDocument.id,
                projectId: project.id,
              });
            }
          }

          let messageCount = 0;
          const messagesBySourceId = new Map<
            string,
            { messageId: string; projectId: string | null }
          >();
          for (const sourceChat of packageData.chats) {
            const projectId = sourceChat.sourceProjectId
              ? projectIdBySourceId.get(sourceChat.sourceProjectId)
              : undefined;
            const messageDates = normalizeMessageDates(
              sourceChat.messages.map((message) => message.createdAt),
              sourceChat.createdAt
            );
            const lastMessageAt = messageDates.at(-1) || sourceChat.createdAt;
            const updatedAt = new Date(
              Math.max(sourceChat.updatedAt.getTime(), lastMessageAt.getTime())
            );
            const chat = await tx.chat.create({
              data: {
                createdAt: sourceChat.createdAt,
                mode: sourceChat.mode,
                model: sourceChat.model,
                projectId,
                title: sourceChat.title,
                updatedAt,
                userId,
              },
            });

            for (
              let offset = 0;
              offset < sourceChat.messages.length;
              offset += MESSAGE_INSERT_BATCH_SIZE
            ) {
              const batch = sourceChat.messages.slice(
                offset,
                offset + MESSAGE_INSERT_BATCH_SIZE
              );

              await tx.message.createMany({
                data: batch.map((message, index) => {
                  const messageId = randomUUID();
                  messagesBySourceId.set(message.sourceId, {
                    messageId,
                    projectId: projectId || null,
                  });
                  return {
                    attachment:
                      message.attachments.length > 0
                        ? toPrismaJson(message.attachments)
                        : undefined,
                    chatId: chat.id,
                    content: message.content,
                    createdAt: messageDates[offset + index],
                    id: messageId,
                    metadata: toPrismaJson({
                      ...(message.isError ? { isError: true } : {}),
                      imported: {
                        archiveType: "account",
                        sourceAccountId: packageData.sourceAccountId,
                        sourceConversationId: sourceChat.sourceId,
                        sourceMessageId: message.sourceId,
                      },
                    }),
                    mode: message.mode,
                    model: message.model,
                    role: toChatRole(message.role),
                  };
                }),
              });
              messageCount += batch.length;
            }
          }

          await finalizeStagedBinaryAssets(
            tx,
            userId,
            uploadedAssets,
            { documentsBySourceId, messagesBySourceId }
          );

          return {
            counts: {
              projects: packageData.projects.length,
              documents: documents.length,
              chats: packageData.chats.length,
              messages: messageCount,
              accountMemories: importedMemoryCount,
              ...(uploadedAssets.length > 0
                ? { binaryAssets: uploadedAssets.length }
                : {}),
            },
            skippedAccountMemories,
            documents,
          };
        },
        PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS
      ));
    },

    async findDocumentIndexStatuses(documentIds) {
      if (documentIds.length === 0) return [];

      return database.projectDocument.findMany({
        select: {
          id: true,
          indexStatus: true,
        },
        where: {
          id: { in: documentIds },
        },
      });
    },
  };
}

export const accountImportRepository = createPrismaAccountImportRepository();

function normalizeMemoryContent(content: string) {
  return content.trim();
}

function toChatRole(role: "user" | "assistant" | "system") {
  if (role === "assistant") return ChatRole.ASSISTANT;
  if (role === "system") return ChatRole.SYSTEM;

  return ChatRole.USER;
}

function normalizeMessageDates(dates: Date[], chatCreatedAt: Date) {
  let previousTimestamp = chatCreatedAt.getTime() - 1;

  return dates.map((date) => {
    const timestamp = date.getTime();
    const normalized = new Date(
      timestamp > previousTimestamp ? timestamp : previousTimestamp + 1
    );
    previousTimestamp = normalized.getTime();
    return normalized;
  });
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function throwImportDestinationLimitExceeded(): never {
  throw new AppError(
    "This import would exceed an account data limit. Delete existing data or import a smaller archive.",
    409,
    "ACCOUNT_IMPORT_DESTINATION_LIMIT_EXCEEDED"
  );
}

async function lockAccountImportQuotas(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:memories:${userId}`}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:projects:${userId}`}, 0))`;
}
