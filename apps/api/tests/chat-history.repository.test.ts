import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaChatHistoryRepository } from "../src/modules/chat-history/chat-history.repository.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

describe("chat history repository reconciliation", () => {
  it("upserts stable message rows and retains normalized attachment links", async () => {
    const harness = createHarness();
    const repository = createPrismaChatHistoryRepository(harness.database);

    await repository.saveUserChat(saveInput([{ assetId: "asset-1", ordinal: 0 }]));

    assert.deepEqual(harness.messageUpserts.map((call) => call.where.id), ["message-1"]);
    assert.deepEqual(harness.messageDeletes, [{
      where: { chatId: "chat-1", id: { notIn: ["message-1"] } },
    }]);
    assert.deepEqual(harness.attachmentCreates, [{
      data: [{ assetId: "asset-1", messageId: "message-1", ordinal: 0 }],
    }]);
    assert.equal(harness.deletionJobs.length, 0);
    assert.equal(harness.assetStatusUpdates.length, 0);
    assert.equal(harness.lockCalls >= 2, true);
  });

  it("queues only assets removed from the whole chat snapshot", async () => {
    const harness = createHarness();
    const repository = createPrismaChatHistoryRepository(harness.database);

    await repository.saveUserChat(saveInput([]));

    assert.equal(harness.attachmentCreates.length, 0);
    assert.equal(harness.deletionJobs.length, 1);
    assert.deepEqual(harness.assetStatusUpdates, [{
      data: { status: "DELETE_PENDING" },
      where: {
        messageAttachment: null,
        objectKey: { in: ["chat-attachments/opaque"] },
        ownerId: "user-1",
        status: "READY",
      },
    }]);
  });

  it("rejects non-READY, wrong-owner, wrong-purpose, and wrong-project assets uniformly", async () => {
    const cases = [
      { ownerId: "other-user" },
      { status: "PENDING" },
      { purpose: "PROJECT_DOCUMENT_SOURCE" },
      { projectId: "other-project" },
    ];

    for (const overrides of cases) {
      const harness = createHarness(overrides);
      const repository = createPrismaChatHistoryRepository(harness.database);

      await assert.rejects(
        () => repository.saveUserChat(saveInput([{ assetId: "asset-1", ordinal: 0 }])),
        (error: unknown) => Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ASSET_NOT_FOUND" &&
          "statusCode" in error &&
          error.statusCode === 404
        )
      );
      assert.equal(harness.messageUpserts.length, 0);
    }
  });
});

function createHarness(assetOverrides: Record<string, unknown> = {}) {
  const messageUpserts: Array<any> = [];
  const messageDeletes: Array<any> = [];
  const attachmentCreates: Array<any> = [];
  const deletionJobs: Array<any> = [];
  const assetStatusUpdates: Array<any> = [];
  let lockCalls = 0;
  const asset = {
    id: "asset-1",
    messageAttachment: {
      message: { chatId: "chat-1" },
      messageId: "message-1",
    },
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "CHAT_ATTACHMENT",
    status: "READY",
    ...assetOverrides,
  };
  const tx = {
    async $executeRaw() { lockCalls += 1; return 1; },
    chat: {
      async findUnique() { return { userId: "user-1" }; },
      async update() { return {}; },
      async create() { return {}; },
      async findFirstOrThrow() {
        return {
          createdAt: NOW,
          id: "chat-1",
          messages: [],
          mode: "general",
          model: "gemini-2.5-flash",
          projectId: "project-1",
          title: "Chat",
          updatedAt: NOW,
        };
      },
    },
    message: {
      async findFirst() { return null; },
      async upsert(input: any) { messageUpserts.push(input); return {}; },
      async deleteMany(input: any) { messageDeletes.push(input); return { count: 0 }; },
    },
    messageAttachment: {
      async findMany() {
        return [{
          assetId: "asset-1",
          asset: {
            objectKey: "chat-attachments/opaque",
            uploadExpiresAt: null,
          },
        }];
      },
      async deleteMany() { return { count: 1 }; },
      async createMany(input: any) { attachmentCreates.push(input); return { count: 1 }; },
    },
    storedAsset: {
      async findMany() { return [asset]; },
      async updateMany(input: any) { assetStatusUpdates.push(input); return { count: 1 }; },
    },
    objectDeletionJob: {
      async createMany(input: any) {
        deletionJobs.push(input);
        return { count: input.data.length };
      },
    },
  };
  const database = {
    async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
      return callback(tx);
    },
  } as unknown as typeof prisma;

  return {
    assetStatusUpdates,
    attachmentCreates,
    database,
    deletionJobs,
    get lockCalls() { return lockCalls; },
    messageDeletes,
    messageUpserts,
  };
}

function saveInput(assetAttachments: Array<{ assetId: string; ordinal: number }>) {
  return {
    chat: {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      mode: "general",
      model: "gemini-2.5-flash",
      messages: [],
    },
    createdAt: NOW,
    messages: [{
      id: "message-1",
      role: "USER" as const,
      content: "Review",
      mode: "general",
      model: "gemini-2.5-flash",
      assetAttachments,
      createdAt: NOW,
    }],
    updatedAt: NOW,
    userId: "user-1",
  };
}
