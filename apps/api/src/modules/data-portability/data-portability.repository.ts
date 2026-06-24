import type { InputJsonValue } from "@prisma/client/runtime/client";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
  ProjectRole,
} from "../../generated/prisma/enums.js";
import type { ProjectDocumentRecord } from "../project-documents/project-documents.repository.js";
import type {
  ProjectExportSourceRecord,
  ValidatedProjectImportPackage,
} from "./data-portability.types.js";

export interface PersistedProjectImport {
  projectId: string;
  projectName: string;
  documents: ProjectDocumentRecord[];
  counts: {
    documents: number;
    chats: number;
    messages: number;
  };
}

export interface DataPortabilityRepository {
  createImportedProject(
    userId: string,
    packageData: ValidatedProjectImportPackage
  ): Promise<PersistedProjectImport>;
  findOwnedProjectExportData(
    userId: string,
    projectId: string,
    includeChats: boolean
  ): Promise<ProjectExportSourceRecord | null>;
  findProjectDocumentIndexStatuses(
    projectId: string,
    documentIds: string[]
  ): Promise<Array<{ id: string; indexStatus: "PENDING" | "READY" | "FAILED" }>>;
}

export function createPrismaDataPortabilityRepository(
  database: typeof prisma = prisma
): DataPortabilityRepository {
  return {
    async createImportedProject(userId, packageData) {
      return database.$transaction(
        async (tx) => {
          const existingProjects = await tx.project.findMany({
            select: {
              name: true,
            },
            where: {
              ownerId: userId,
            },
          });
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
          for (const document of packageData.project.documents) {
            documents.push(
              await tx.projectDocument.create({
                data: {
                  content: document.content,
                  metadata: toPrismaJson(document.metadata),
                  mimeType: document.mimeType,
                  projectId: project.id,
                  source: ProjectDocumentSource.IMPORTED,
                  title: document.title,
                },
              })
            );
          }

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
                data: chat.messages.map((message) => ({
                  attachment:
                    message.attachments.length > 0
                      ? toPrismaJson(message.attachments)
                      : undefined,
                  chatId: createdChat.id,
                  content: message.content,
                  createdAt: message.createdAt,
                  metadata: message.isError
                    ? toPrismaJson({
                        isError: true,
                      })
                    : undefined,
                  mode: message.mode,
                  model: message.model,
                  role: toPrismaChatRole(message.role),
                })),
              });
            }
          }

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
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    },

    async findOwnedProjectExportData(userId, projectId, includeChats) {
      const project = await database.project.findFirst({
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
              mimeType: true,
              metadata: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        where: {
          id: projectId,
          ownerId: userId,
        },
      });

      if (!project) return null;

      const chats = includeChats
        ? await database.chat.findMany({
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
              messages: {
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
                  role: true,
                  content: true,
                  mode: true,
                  model: true,
                  attachment: true,
                  metadata: true,
                  createdAt: true,
                },
              },
            },
            where: {
              projectId,
              userId,
            },
          })
        : [];

      return {
        ...project,
        chats,
      };
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

export function resolveImportedProjectName(
  sourceProjectName: string,
  existingProjectNames: string[]
) {
  const names = new Set(
    existingProjectNames.map((name) => name.toLocaleLowerCase("en-US"))
  );

  for (let sequence = 1; sequence <= existingProjectNames.length + 2; sequence += 1) {
    const suffix =
      sequence === 1 ? " (Imported)" : ` (Imported ${sequence})`;
    const availableChars = 120 - suffix.length;
    const sourceName = sourceProjectName.slice(0, availableChars).trimEnd();
    const candidate = `${sourceName}${suffix}`;

    if (!names.has(candidate.toLocaleLowerCase("en-US"))) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve an imported project name.");
}

function toPrismaChatRole(role: "user" | "assistant" | "system") {
  if (role === "assistant") return ChatRole.ASSISTANT;
  if (role === "system") return ChatRole.SYSTEM;

  return ChatRole.USER;
}

function toPrismaJson(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}
