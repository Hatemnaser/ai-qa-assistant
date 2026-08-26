import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaAccountDataPortabilityRepository } from "../src/modules/data-portability/account-data-portability.repository.ts";
import { createPrismaDataPortabilityRepository } from "../src/modules/data-portability/data-portability.repository.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");

describe("project export asset repository boundary", () => {
  it("selects owner-scoped relations and maps message bindings", async () => {
    let assetQuery: Record<string, unknown> | undefined;
    let messageQuery: Record<string, unknown> | undefined;
    const tx = {
      chat: {
        async findMany() {
          return [{
            id: "chat-1",
            title: "Chat",
            mode: "general",
            model: "gemini-3.1-flash-lite",
            createdAt: NOW,
            updatedAt: NOW,
          }];
        },
      },
      message: {
        async findMany(args: Record<string, unknown>) {
          messageQuery = args;
          return [{
            id: "message-1",
            chatId: "chat-1",
            role: "USER",
            content: "Question",
            mode: "general",
            model: "gemini-3.1-flash-lite",
            attachment: [{ type: "file", name: "note.txt", mimeType: "text/plain" }],
            attachments: [{ assetId: "asset-1", ordinal: 0 }],
            metadata: null,
            createdAt: NOW,
          }];
        },
      },
      project: {
        async findFirst() {
          return {
            id: "project-1",
            name: "Project",
            description: null,
            createdAt: NOW,
            updatedAt: NOW,
            instruction: null,
            projectMemory: null,
            documents: [],
          };
        },
      },
      storedAsset: {
        async findMany(args: Record<string, unknown>) {
          assetQuery = args;
          return [{
            checksumSha256: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
            createdAt: NOW,
            declaredMimeType: "text/plain",
            detectedMimeType: "text/plain",
            etag: "etag-1",
            expectedSizeBytes: 128,
            id: "asset-1",
            messageAttachment: { messageId: "message-1", ordinal: 0 },
            objectKey: "chat-attachments/source-1",
            originalName: "note.txt",
            ownerId: "user-1",
            projectId: "project-1",
            purpose: "CHAT_ATTACHMENT",
            readyAt: NOW,
            sizeBytes: 128,
            sourceDocument: null,
            status: "READY",
            updatedAt: NOW,
            uploadExpiresAt: null,
            validationStartedAt: null,
          }];
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const result = await createPrismaDataPortabilityRepository(database)
      .findOwnedProjectExportData("user-1", "project-1", true);

    assert.deepEqual(result?.binaryAssets[0]?.binding, {
      kind: "message_attachment",
      ordinal: 0,
      sourceMessageId: "message-1",
    });
    assert.deepEqual(
      (messageQuery?.select as { attachments?: unknown }).attachments,
      {
        orderBy: { ordinal: "asc" },
        select: { assetId: true, ordinal: true },
      }
    );
    assert.equal(
      Object.hasOwn(result?.chats[0]?.messages[0] || {}, "attachments"),
      false
    );
    assert.deepEqual(assetQuery?.where, {
      OR: [
        { sourceDocument: { projectId: "project-1" } },
        {
          messageAttachment: {
            message: {
              chat: { projectId: "project-1", userId: "user-1" },
            },
          },
        },
      ],
      ownerId: "user-1",
    });
  });

  it("does not query chat attachment relations when chats are excluded", async () => {
    let assetWhere: unknown;
    let projectQuery: Record<string, unknown> | undefined;
    const tx = {
      project: {
        async findFirst(args: Record<string, unknown>) {
          projectQuery = args;
          return {
            id: "project-1",
            name: "Project",
            description: null,
            createdAt: NOW,
            updatedAt: NOW,
            instruction: null,
            projectMemory: null,
            documents: [{
              id: "document-1",
              title: "Source",
              content: "source",
              source: "IMPORTED",
              sourceAssetId: "asset-1",
              mimeType: "text/plain",
              metadata: null,
              createdAt: NOW,
              updatedAt: NOW,
            }],
          };
        },
      },
      storedAsset: {
        async findMany(args: { where: unknown }) {
          assetWhere = args.where;
          return [{
            checksumSha256: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
            createdAt: NOW,
            declaredMimeType: "text/plain",
            detectedMimeType: "text/plain",
            etag: "etag-1",
            expectedSizeBytes: 128,
            id: "asset-1",
            messageAttachment: null,
            objectKey: "project-documents/source-1",
            originalName: "source.txt",
            ownerId: "user-1",
            projectId: "project-1",
            purpose: "PROJECT_DOCUMENT_SOURCE",
            readyAt: NOW,
            sizeBytes: 128,
            sourceDocument: { id: "document-1" },
            status: "READY",
            updatedAt: NOW,
            uploadExpiresAt: null,
            validationStartedAt: null,
          }];
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    const result = await createPrismaDataPortabilityRepository(database)
      .findOwnedProjectExportData("user-1", "project-1", false);

    assert.deepEqual(result?.binaryAssets[0]?.binding, {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    });
    assert.equal(
      Object.hasOwn(result?.documents[0] || {}, "sourceAssetId"),
      false
    );
    assert.equal(
      ((projectQuery?.select as {
        documents?: { select?: { sourceAssetId?: boolean } };
      }).documents?.select?.sourceAssetId),
      true
    );
    assert.deepEqual(assetWhere, {
      OR: [{ sourceDocument: { projectId: "project-1" } }],
      ownerId: "user-1",
    });
  });

  it("fails closed if one stored object is linked as both a message and document", async () => {
    const tx = {
      project: {
        async findFirst() {
          return {
            id: "project-1",
            name: "Project",
            description: null,
            createdAt: NOW,
            updatedAt: NOW,
            instruction: null,
            projectMemory: null,
            documents: [{
              id: "document-1",
              title: "Source",
              content: "source",
              source: "IMPORTED",
              sourceAssetId: "asset-1",
              mimeType: "text/plain",
              metadata: null,
              createdAt: NOW,
              updatedAt: NOW,
            }],
          };
        },
      },
      storedAsset: {
        async findMany() {
          return [{
            checksumSha256: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
            createdAt: NOW,
            declaredMimeType: "text/plain",
            detectedMimeType: "text/plain",
            etag: "etag-1",
            expectedSizeBytes: 128,
            id: "asset-1",
            messageAttachment: { messageId: "message-1", ordinal: 0 },
            objectKey: "corrupt/double-link",
            originalName: "note.txt",
            ownerId: "user-1",
            projectId: "project-1",
            purpose: "CHAT_ATTACHMENT",
            readyAt: NOW,
            sizeBytes: 128,
            sourceDocument: { id: "document-1" },
            status: "READY",
            updatedAt: NOW,
            uploadExpiresAt: null,
            validationStartedAt: null,
          }];
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaDataPortabilityRepository(database)
        .findOwnedProjectExportData("user-1", "project-1", false),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ASSET_PORTABILITY_UNAVAILABLE"
        )
    );
  });

  it("fails closed when a selected message points at an unselected or foreign asset", async () => {
    const tx = {
      chat: {
        async findMany() {
          return [{
            id: "chat-1",
            title: "Chat",
            mode: "general",
            model: "gemini-3.1-flash-lite",
            createdAt: NOW,
            updatedAt: NOW,
          }];
        },
      },
      message: {
        async findMany() {
          return [{
            id: "message-1",
            chatId: "chat-1",
            role: "USER",
            content: "Question",
            mode: "general",
            model: null,
            attachment: null,
            attachments: [{ assetId: "foreign-asset", ordinal: 0 }],
            metadata: null,
            createdAt: NOW,
          }];
        },
      },
      project: {
        async findFirst() {
          return {
            id: "project-1",
            name: "Project",
            description: null,
            createdAt: NOW,
            updatedAt: NOW,
            instruction: null,
            projectMemory: null,
            documents: [],
          };
        },
      },
      storedAsset: {
        async findMany() {
          return [];
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaDataPortabilityRepository(database)
        .findOwnedProjectExportData("user-1", "project-1", true),
      isAssetPortabilityUnavailable
    );
  });
});

describe("account export asset repository boundary", () => {
  it("fails closed when account data points at an unselected or foreign asset", async () => {
    const tx = {
      message: {
        async findMany() {
          return [{
            id: "message-1",
            chatId: "chat-1",
            role: "USER",
            content: "Question",
            mode: "general",
            model: null,
            attachment: null,
            attachments: [{ assetId: "foreign-asset", ordinal: 0 }],
            metadata: null,
            createdAt: NOW,
          }];
        },
      },
      projectDocument: {
        async findMany() {
          return [];
        },
      },
      storedAsset: {
        async findMany() {
          return [];
        },
      },
      user: {
        async findUnique() {
          return {
            id: "user-1",
            acceptedTermsAt: null,
            acceptedTermsVersion: null,
            email: "owner@example.com",
            name: "Owner",
            locale: "en",
            createdAt: NOW,
            updatedAt: NOW,
            settings: null,
            memories: [],
            ownedProjects: [],
            chats: [{
              id: "chat-1",
              projectId: null,
              title: "Chat",
              mode: "general",
              model: "gemini-3.1-flash-lite",
              createdAt: NOW,
              updatedAt: NOW,
            }],
          };
        },
      },
    };
    const database = {
      async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
        return callback(tx);
      },
    } as unknown as typeof prisma;

    await assert.rejects(
      () => createPrismaAccountDataPortabilityRepository(database)
        .findAccountExportData("user-1"),
      isAssetPortabilityUnavailable
    );
  });
});

function isAssetPortabilityUnavailable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ASSET_PORTABILITY_UNAVAILABLE"
  );
}
