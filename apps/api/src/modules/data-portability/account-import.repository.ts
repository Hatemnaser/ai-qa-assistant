import type { InputJsonValue } from "@prisma/client/runtime/client";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  ChatRole,
  MemoryScope,
  MemorySource,
  ProjectDocumentSource,
  ProjectRole,
} from "../../generated/prisma/enums.js";
import type { ProjectDocumentRecord } from "../project-documents/project-documents.repository.js";
import { resolveImportedProjectName } from "./data-portability.repository.js";
import type {
  PersistedNativeAccountImport,
  ValidatedNativeAccountImport,
} from "./account-import.types.js";

const MESSAGE_INSERT_BATCH_SIZE = 500;

export interface AccountImportRepository {
  createImportedAccount(
    userId: string,
    packageData: ValidatedNativeAccountImport
  ): Promise<PersistedNativeAccountImport>;
  findDocumentIndexStatuses(
    documentIds: string[]
  ): Promise<Array<{ id: string; indexStatus: "PENDING" | "READY" | "FAILED" }>>;
}

export function createPrismaAccountImportRepository(
  database: typeof prisma = prisma
): AccountImportRepository {
  return {
    async createImportedAccount(userId, packageData) {
      return database.$transaction(
        async (tx) => {
          const [existingProjects, existingMemories] = await Promise.all([
            tx.project.findMany({
              select: { name: true },
              where: { ownerId: userId },
            }),
            tx.memory.findMany({
              select: { content: true },
              where: {
                scope: MemoryScope.USER,
                userId,
              },
            }),
          ]);
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
              documents.push(
                await tx.projectDocument.create({
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
                })
              );
            }
          }

          let messageCount = 0;
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
                data: batch.map((message, index) => ({
                  attachment:
                    message.attachments.length > 0
                      ? toPrismaJson(message.attachments)
                      : undefined,
                  chatId: chat.id,
                  content: message.content,
                  createdAt: messageDates[offset + index],
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
                })),
              });
              messageCount += batch.length;
            }
          }

          return {
            counts: {
              projects: packageData.projects.length,
              documents: documents.length,
              chats: packageData.chats.length,
              messages: messageCount,
              accountMemories: importedMemoryCount,
            },
            skippedAccountMemories,
            documents,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
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

function toPrismaJson(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}
