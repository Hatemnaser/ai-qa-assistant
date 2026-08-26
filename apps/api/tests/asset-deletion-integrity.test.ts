import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaChatHistoryRepository } from "../src/modules/chat-history/chat-history.repository.ts";
import { createPrismaProjectDocumentsRepository } from "../src/modules/project-documents/project-documents.repository.ts";
import { createPrismaProjectsRepository } from "../src/modules/projects/projects.repository.ts";

describe("asset deletion integrity", () => {
  it("queues project-document objects in the same transaction as project deletion", async () => {
    const operations: string[] = [];
    const tx = {
      objectDeletionJob: deletionJobs(operations),
      project: {
        async deleteMany() {
          operations.push("project:delete");
          return { count: 1 };
        },
        async findFirst() {
          operations.push("project:find");
          return {
            storedAssets: [
              { objectKey: "users/u1/doc-1", uploadExpiresAt: null },
              { objectKey: "users/u1/doc-2", uploadExpiresAt: null },
            ],
          };
        },
      },
      storedAsset: deletionPendingAssets(operations),
    };
    const repository = createPrismaProjectsRepository(transactionDatabase(tx, operations));

    assert.equal(await repository.deleteOwnedProject("u1", "p1"), 1);
    assert.deepEqual(operations, [
      "transaction:start",
      "project:find",
      "jobs:users/u1/doc-1,users/u1/doc-2",
      "assets:delete-pending:2",
      "project:delete",
      "transaction:commit",
    ]);
  });

  it("queues the source object before deleting a project document", async () => {
    const operations: string[] = [];
    const tx = {
      objectDeletionJob: deletionJobs(operations),
      projectDocument: {
        async deleteMany() {
          operations.push("document:delete");
          return { count: 1 };
        },
        async findFirst() {
          operations.push("document:find");
          return { sourceAsset: { objectKey: "users/u1/document-source", uploadExpiresAt: null } };
        },
      },
      storedAsset: deletionPendingAssets(operations),
    };
    const repository = createPrismaProjectDocumentsRepository(transactionDatabase(tx, operations));

    assert.equal(await repository.deleteProjectDocument("p1", "d1"), 1);
    assert.deepEqual(operations, [
      "transaction:start",
      "document:find",
      "jobs:users/u1/document-source",
      "assets:delete-pending:1",
      "document:delete",
      "transaction:commit",
    ]);
  });

  it("queues every message attachment before deleting its chat", async () => {
    const operations: string[] = [];
    const tx = {
      async $executeRaw() {
        operations.push("chat:lock");
        return 1;
      },
      chat: {
        async deleteMany() {
          operations.push("chat:delete");
          return { count: 1 };
        },
        async findFirst() {
          operations.push("chat:find");
          return {
            messages: [
              { attachments: [{ asset: { objectKey: "users/u1/chat-image", uploadExpiresAt: null } }] },
              { attachments: [{ asset: { objectKey: "users/u1/chat-file", uploadExpiresAt: null } }] },
            ],
          };
        },
      },
      objectDeletionJob: deletionJobs(operations),
      storedAsset: deletionPendingAssets(operations),
    };
    const repository = createPrismaChatHistoryRepository(transactionDatabase(tx, operations));

    assert.equal(await repository.deleteUserChat("u1", "c1"), 1);
    assert.deepEqual(operations, [
      "transaction:start",
      "chat:lock",
      "chat:find",
      "jobs:users/u1/chat-image,users/u1/chat-file",
      "assets:delete-pending:2",
      "chat:delete",
      "transaction:commit",
    ]);
  });
});

function transactionDatabase(transaction: unknown, operations: string[]) {
  return {
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      operations.push("transaction:start");
      const result = await callback(transaction);
      operations.push("transaction:commit");
      return result;
    },
  } as unknown as typeof prisma;
}

function deletionJobs(operations: string[]) {
  return {
    async createMany(input: { data: Array<{ objectKey: string }> }) {
      operations.push(`jobs:${input.data.map(({ objectKey }) => objectKey).join(",")}`);
      return { count: input.data.length };
    },
  };
}

function deletionPendingAssets(operations: string[]) {
  return {
    async updateMany(input: { where: { objectKey: string | { in: string[] } } }) {
      const objectKey = input.where.objectKey;
      const count = typeof objectKey === "string" ? 1 : objectKey.in.length;
      operations.push(`assets:delete-pending:${count}`);
      return { count };
    },
  };
}
