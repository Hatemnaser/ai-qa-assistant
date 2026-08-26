import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaAccountRepository } from "../src/modules/account/account.repository.ts";

describe("account repository", () => {
  it("queues owned objects and removes identifying usage before the cascading user graph", async () => {
    const operations: string[] = [];
    const transaction = {
      storedAsset: {
        async findMany(input: { where: { ownerId: string } }) {
          operations.push(`storedAsset:${input.where.ownerId}`);
          return [
            { objectKey: "assets/2026/08/12/asset-1", uploadExpiresAt: null },
            { objectKey: "assets/2026/08/12/asset-2", uploadExpiresAt: null },
          ];
        },
        async deleteMany(input: { where: { ownerId: string } }) {
          operations.push(`storedAsset:delete:${input.where.ownerId}`);
          return { count: 2 };
        },
      },
      objectDeletionJob: {
        async createMany(input: { data: Array<{ objectKey: string }> }) {
          operations.push(
            `objectDeletionJob:${input.data.map(({ objectKey }) => objectKey).join(",")}`
          );
          return { count: input.data.length };
        },
      },
      messageAttachment: {
        async deleteMany() {
          operations.push("messageAttachment:user-1");
          return { count: 2 };
        },
      },
      projectDocument: {
        async updateMany() {
          operations.push("projectDocument:user-1");
          return { count: 1 };
        },
      },
      aiUsageLog: createDeleteModel("aiUsageLog", operations),
      usageEvent: createDeleteModel("usageEvent", operations),
      user: createDeleteModel("user", operations),
    };
    let transactionOptions: unknown;
    const database = {
      async $transaction(
        callback: (tx: typeof transaction) => Promise<void>,
        options: unknown
      ) {
        transactionOptions = options;
        operations.push("transaction:start");
        await callback(transaction);
        operations.push("transaction:commit");
      },
      user: {
        async findUnique() {
          return null;
        },
      },
    } as unknown as typeof prisma;
    const repository = createPrismaAccountRepository(database);

    await repository.deleteAccountData("user-1");

    assert.deepEqual(operations, [
      "transaction:start",
      "storedAsset:user-1",
      "objectDeletionJob:assets/2026/08/12/asset-1,assets/2026/08/12/asset-2",
      "messageAttachment:user-1",
      "projectDocument:user-1",
      "storedAsset:delete:user-1",
      "aiUsageLog:user-1",
      "usageEvent:user-1",
      "user:user-1",
      "transaction:commit",
    ]);
    assert.deepEqual(transactionOptions, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 60_000,
    });
  });

  it("reads only the credential fields needed for confirmation", async () => {
    let query: unknown;
    const database = {
      async $transaction() {},
      user: {
        async findUnique(input: unknown) {
          query = input;
          return { id: "user-1", passwordHash: "stored-hash" };
        },
      },
    } as unknown as typeof prisma;
    const repository = createPrismaAccountRepository(database);

    assert.deepEqual(await repository.findAccountCredentials("user-1"), {
      id: "user-1",
      passwordHash: "stored-hash",
    });
    assert.deepEqual(query, {
      select: { id: true, passwordHash: true },
      where: { id: "user-1" },
    });
  });
});

function createDeleteModel(name: string, operations: string[]) {
  return {
    async deleteMany(input: { where: { id?: string; userId?: string } }) {
      operations.push(`${name}:${input.where.id || input.where.userId}`);
      return { count: 1 };
    },
  };
}
