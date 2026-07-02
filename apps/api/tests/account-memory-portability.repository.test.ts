import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import {
  MemoryScope,
  MemorySource,
} from "../src/generated/prisma/enums.ts";
import { createPrismaAccountMemoryPortabilityRepository } from "../src/modules/data-portability/account-memory-portability.repository.ts";
import type { PortableAccountMemoryRecord } from "../src/modules/data-portability/account-memory-portability.types.ts";

describe("Account Memory portability repository", () => {
  it("lists only owner-scoped USER memories", async () => {
    const database = createFakeDatabase([
      storedMemory({
        id: "memory-1",
        userId: "user-1",
      }),
      storedMemory({
        id: "memory-2",
        scope: MemoryScope.PROJECT,
        userId: "user-1",
      }),
      storedMemory({
        id: "memory-3",
        userId: "user-2",
      }),
    ]);
    const repository = createPrismaAccountMemoryPortabilityRepository(
      database.value
    );

    const result = await repository.listAccountMemories("user-1");

    assert.deepEqual(
      result.map((memory) => memory.id),
      ["memory-1"]
    );
    assert.deepEqual(database.listWhere, {
      scope: MemoryScope.USER,
      userId: "user-1",
    });
  });

  it("rechecks duplicates and creates new IMPORTED records in one serializable transaction", async () => {
    const database = createFakeDatabase([
      storedMemory({
        content: "Existing memory",
        id: "existing-memory",
        userId: "user-1",
      }),
      storedMemory({
        content: "Foreign memory",
        id: "foreign-memory",
        userId: "user-2",
      }),
    ]);
    const repository = createPrismaAccountMemoryPortabilityRepository(
      database.value
    );

    const result = await repository.importAccountMemories("user-1", [
      portableMemory(" Existing memory ", "source-1"),
      portableMemory("New memory", "source-2"),
      portableMemory("New memory", "source-3"),
    ]);

    assert.deepEqual(result, {
      created: 1,
      skippedExistingDuplicates: 2,
      currentMemoryCount: 2,
    });
    assert.equal(database.transactionCalls, 1);
    assert.equal(database.isolationLevel, "Serializable");

    const created = database.rows.find(
      (memory) => memory.content === "New memory"
    );
    assert.ok(created);
    assert.equal(created.userId, "user-1");
    assert.equal(created.scope, MemoryScope.USER);
    assert.equal(created.source, MemorySource.IMPORTED);
    assert.notEqual(created.id, "source-2");
    assert.equal(created.projectId, null);
    assert.equal(created.chatId, null);
  });

  it("rolls back all imported records when a canonical write fails", async () => {
    const database = createFakeDatabase(
      [
        storedMemory({
          content: "Existing memory",
          id: "existing-memory",
          userId: "user-1",
        }),
      ],
      {
        failOnContent: "Second memory",
      }
    );
    const repository = createPrismaAccountMemoryPortabilityRepository(
      database.value
    );

    await assert.rejects(() =>
      repository.importAccountMemories("user-1", [
        portableMemory("First memory", "source-1"),
        portableMemory("Second memory", "source-2"),
      ])
    );

    assert.deepEqual(
      database.rows.map((memory) => memory.content),
      ["Existing memory"]
    );
    assert.equal(database.transactionCalls, 1);
  });
});

interface StoredMemory {
  id: string;
  userId: string | null;
  projectId: string | null;
  chatId: string | null;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  confidence: number;
  metadata: null;
  createdAt: Date;
  updatedAt: Date;
}

function createFakeDatabase(
  initialRows: StoredMemory[] = [],
  options: {
    failOnContent?: string;
  } = {}
) {
  const rows = [...initialRows];
  let transactionCalls = 0;
  let isolationLevel: unknown;
  let listWhere: unknown;

  const memory = {
    async findMany(args: {
      where?: {
        scope?: MemoryScope;
        userId?: string;
      };
      select?: Record<string, boolean>;
    }) {
      listWhere = args.where;
      const matched = rows.filter(
        (row) =>
          (!args.where?.scope || row.scope === args.where.scope) &&
          (!args.where?.userId || row.userId === args.where.userId)
      );

      if (args.select && Object.keys(args.select).length === 1) {
        return matched.map((row) => ({
          content: row.content,
        }));
      }

      return matched.map((row) => ({
        id: row.id,
        content: row.content,
        source: row.source,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },

    async create(args: {
      data: {
        confidence: number;
        content: string;
        scope: MemoryScope;
        source: MemorySource;
        userId: string;
      };
    }) {
      if (args.data.content === options.failOnContent) {
        throw new Error("canonical memory write failed");
      }

      const row = storedMemory({
        ...args.data,
        id: `new-memory-${rows.length + 1}`,
        chatId: null,
        projectId: null,
      });
      rows.push(row);

      return row;
    },
  };
  const database = {
    memory,
    async $transaction(
      callback: (transaction: { memory: typeof memory }) => Promise<unknown>,
      transactionOptions: {
        isolationLevel?: unknown;
      }
    ) {
      transactionCalls += 1;
      isolationLevel = transactionOptions.isolationLevel;
      const snapshot = [...rows];

      try {
        return await callback({
          memory,
        });
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    },
  };

  return {
    get isolationLevel() {
      return isolationLevel;
    },
    get listWhere() {
      return listWhere;
    },
    get rows() {
      return rows;
    },
    get transactionCalls() {
      return transactionCalls;
    },
    value: database as unknown as typeof prisma,
  };
}

function storedMemory(overrides: Partial<StoredMemory> = {}): StoredMemory {
  return {
    id: "memory-1",
    userId: "user-1",
    projectId: null,
    chatId: null,
    scope: MemoryScope.USER,
    content: "Memory",
    source: MemorySource.USER_PROVIDED,
    confidence: 1,
    metadata: null,
    createdAt: new Date("2026-07-03T09:00:00.000Z"),
    updatedAt: new Date("2026-07-03T09:30:00.000Z"),
    ...overrides,
  };
}

function portableMemory(
  content: string,
  sourceId: string
): PortableAccountMemoryRecord {
  return {
    sourceId,
    content,
    source: "USER_PROVIDED",
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:30:00.000Z",
  };
}
