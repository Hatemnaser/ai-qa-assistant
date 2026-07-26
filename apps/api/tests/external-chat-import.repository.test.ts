import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaExternalChatImportRepository } from "../src/modules/data-portability/external-chat-import.repository.ts";
import type { ValidatedExternalChatImport } from "../src/modules/data-portability/external-chat-import.types.ts";

describe("external chat import repository", () => {
  it("creates new standalone chats and messages in one serializable transaction", async () => {
    const database = createFakeDatabase();
    const repository = createPrismaExternalChatImportRepository(
      database.value,
      () => new Date("2026-07-03T12:00:00.000Z")
    );

    const result = await repository.createImportedChats(
      "user-1",
      createPackage()
    );

    assert.deepEqual(result, {
      chats: 1,
      messages: 2,
    });
    assert.equal(database.transactionCalls, 1);
    assert.equal(database.isolationLevel, "Serializable");
    assert.equal(database.chats[0]?.id, "new-chat-1");
    assert.notEqual(database.chats[0]?.id, "source-chat-1");
    assert.equal(database.chats[0]?.userId, "user-1");
    assert.equal(database.chats[0]?.projectId, undefined);
    assert.equal(database.messages.length, 2);
    assert.equal(database.messages[0]?.id, undefined);
    assert.match(
      JSON.stringify(database.messages[0]?.metadata),
      /source-message-1/
    );
  });

  it("rolls back the whole import when a canonical message write fails", async () => {
    const database = createFakeDatabase({
      failMessages: true,
    });
    const repository = createPrismaExternalChatImportRepository(database.value);

    await assert.rejects(() =>
      repository.createImportedChats("user-1", createPackage())
    );

    assert.deepEqual(database.chats, []);
    assert.deepEqual(database.messages, []);
    assert.equal(database.transactionCalls, 1);
  });

  it("batches large message inserts and preserves source order without timestamps", async () => {
    const database = createFakeDatabase();
    const repository = createPrismaExternalChatImportRepository(
      database.value,
      () => new Date("2026-07-03T12:00:00.000Z")
    );
    const packageData = createPackage();

    packageData.chats[0]!.messages = Array.from({ length: 501 }, (_, index) => ({
      sourceId: `source-message-${index + 1}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index + 1}`,
      createdAt: null,
      originalModel: null,
    }));

    const result = await repository.createImportedChats("user-1", packageData);

    assert.deepEqual(result, {
      chats: 1,
      messages: 501,
    });
    assert.equal(database.messageInsertCalls, 2);
    const timestamps = database.messages.map((message) =>
      (message.createdAt as Date).getTime()
    );
    assert.ok(
      timestamps.every(
        (timestamp, index) => index === 0 || timestamp > timestamps[index - 1]!
      )
    );
    assert.ok(
      (database.chats[0]?.updatedAt as Date).getTime() >= timestamps.at(-1)!
    );
  });
});

function createFakeDatabase(options: { failMessages?: boolean } = {}) {
  const chats: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  let transactionCalls = 0;
  let messageInsertCalls = 0;
  let isolationLevel: unknown;
  const transaction = {
    userSettings: {
      async findUnique() {
        return {
          defaultModel: "gemini-3.1-flash-lite",
        };
      },
    },
    chat: {
      async create(args: { data: Record<string, unknown> }) {
        const chat = {
          id: `new-chat-${chats.length + 1}`,
          ...args.data,
        };
        chats.push(chat);
        return chat;
      },
    },
    message: {
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        messageInsertCalls += 1;
        if (options.failMessages) {
          throw new Error("message write failed");
        }

        messages.push(...args.data);
        return {
          count: args.data.length,
        };
      },
    },
  };
  const database = {
    async $transaction(
      callback: (tx: typeof transaction) => Promise<unknown>,
      options: {
        isolationLevel?: unknown;
      }
    ) {
      transactionCalls += 1;
      isolationLevel = options.isolationLevel;
      const chatSnapshot = [...chats];
      const messageSnapshot = [...messages];

      try {
        return await callback(transaction);
      } catch (error) {
        chats.splice(0, chats.length, ...chatSnapshot);
        messages.splice(0, messages.length, ...messageSnapshot);
        throw error;
      }
    },
  };

  return {
    chats,
    get isolationLevel() {
      return isolationLevel;
    },
    messages,
    get messageInsertCalls() {
      return messageInsertCalls;
    },
    get transactionCalls() {
      return transactionCalls;
    },
    value: database as unknown as typeof prisma,
  };
}

function createPackage(): ValidatedExternalChatImport {
  return {
    packageDigest: "a".repeat(64),
    provider: "chatgpt",
    warnings: [],
    chats: [
      {
        sourceId: "source-chat-1",
        title: "Imported chat",
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
        updatedAt: new Date("2026-07-01T10:05:00.000Z"),
        messages: [
          {
            sourceId: "source-message-1",
            role: "user",
            content: "Hello",
            createdAt: new Date("2026-07-01T10:00:00.000Z"),
            originalModel: null,
          },
          {
            sourceId: "source-message-2",
            role: "assistant",
            content: "Hi",
            createdAt: new Date("2026-07-01T10:00:10.000Z"),
            originalModel: "gpt-test",
          },
        ],
      },
    ],
  };
}
