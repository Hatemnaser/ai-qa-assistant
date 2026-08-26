import { prisma } from "../../db/prisma.js";
import { AppError } from "../../lib/errors.js";
import { MemoryScope, MemorySource } from "../../generated/prisma/enums.js";
import { BINARY_ASSET_PORTABILITY_LIMITS } from "./binary-assets.js";
import { bindCompleteExportAssetRows } from "./export-asset-relations.js";
import { PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS } from "./portability-transaction.js";
import {
  ACCOUNT_EXPORT_LIMITS,
  type AccountDataPortabilityRepository,
  type AccountExportChatRecord,
  type AccountExportProjectRecord,
  type AccountExportSourceRecord,
} from "./account-data-portability.types.js";

export function createPrismaAccountDataPortabilityRepository(
  database: typeof prisma = prisma
): AccountDataPortabilityRepository {
  return {
    async findAccountExportData(userId) {
      return database.$transaction(async (tx) => {
      const account = await tx.user.findUnique({
        select: {
          id: true,
          acceptedTermsAt: true,
          acceptedTermsVersion: true,
          email: true,
          name: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
          settings: {
            select: {
              language: true,
              theme: true,
              defaultModel: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          memories: {
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
              content: true,
              source: true,
              createdAt: true,
              updatedAt: true,
            },
            where: {
              scope: MemoryScope.USER,
              source: {
                in: [MemorySource.USER_PROVIDED, MemorySource.IMPORTED],
              },
            },
            take: ACCOUNT_EXPORT_LIMITS.maxAccountMemories + 1,
          },
          ownedProjects: {
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
            },
            take: ACCOUNT_EXPORT_LIMITS.maxProjects + 1,
          },
          chats: {
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
              projectId: true,
              title: true,
              mode: true,
              model: true,
              createdAt: true,
              updatedAt: true,
            },
            take: ACCOUNT_EXPORT_LIMITS.maxChats + 1,
          },
        },
        where: {
          id: userId,
        },
      });

      if (!account) return null;

      if (
        account.memories.length > ACCOUNT_EXPORT_LIMITS.maxAccountMemories ||
        account.ownedProjects.length > ACCOUNT_EXPORT_LIMITS.maxProjects ||
        account.chats.length > ACCOUNT_EXPORT_LIMITS.maxChats
      ) {
        throwAccountExportTooLarge();
      }

      const [documentRows, messageRows, assetRows] = await Promise.all([
        tx.projectDocument.findMany({
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            projectId: true,
            title: true,
            content: true,
            source: true,
            mimeType: true,
            metadata: true,
            sourceAssetId: true,
            createdAt: true,
            updatedAt: true,
          },
          take: ACCOUNT_EXPORT_LIMITS.maxDocuments + 1,
          where: {
            project: {
              ownerId: userId,
            },
          },
        }),
        tx.message.findMany({
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
          take: ACCOUNT_EXPORT_LIMITS.maxMessages + 1,
          where: {
            chat: {
              userId,
            },
          },
        }),
        tx.storedAsset.findMany({
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
              { messageAttachment: { message: { chat: { userId } } } },
              { sourceDocument: { project: { ownerId: userId } } },
            ],
            ownerId: userId,
          },
        }),
      ]);

      if (
        documentRows.length > ACCOUNT_EXPORT_LIMITS.maxDocuments ||
        messageRows.length > ACCOUNT_EXPORT_LIMITS.maxMessages ||
        assetRows.length > BINARY_ASSET_PORTABILITY_LIMITS.maxAssets
      ) {
        throwAccountExportTooLarge();
      }

      const binaryAssets = bindCompleteExportAssetRows(
        userId,
        assetRows,
        documentRows,
        messageRows
      );

      const documentsByProject = new Map<
        string,
        AccountExportProjectRecord["documents"]
      >();
      for (const { projectId, sourceAssetId, ...document } of documentRows) {
        void sourceAssetId;
        const documents = documentsByProject.get(projectId) || [];
        documents.push(document);
        documentsByProject.set(projectId, documents);
      }
      const messagesByChat = new Map<
        string,
        AccountExportChatRecord["messages"]
      >();
      for (const { attachments, chatId, ...message } of messageRows) {
        void attachments;
        const messages = messagesByChat.get(chatId) || [];
        messages.push(message);
        messagesByChat.set(chatId, messages);
      }

      const projects = account.ownedProjects.map((project) => ({
        ...project,
        documents: documentsByProject.get(project.id) || [],
      }));
      const chats = account.chats.map((chat) => ({
        ...chat,
        messages: messagesByChat.get(chat.id) || [],
      }));

      return {
        ...account,
        binaryAssets,
        chats,
        projects,
      };
      }, PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS);
    },
  };
}

export const accountDataPortabilityRepository =
  createPrismaAccountDataPortabilityRepository();

function throwAccountExportTooLarge(): never {
  throw new AppError(
    "Account data export is too large to package safely.",
    413,
    "ACCOUNT_EXPORT_TOO_LARGE"
  );
}
