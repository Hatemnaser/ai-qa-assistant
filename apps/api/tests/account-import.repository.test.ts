import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaAccountImportRepository } from "../src/modules/data-portability/account-import.repository.ts";
import type { ValidatedNativeAccountImport } from "../src/modules/data-portability/account-import.types.ts";

describe("native account import repository", () => {
  it("creates new IDs, preserves project-chat links, and skips exact trimmed memories", async () => {
    const database = createFakeDatabase();
    const repository = createPrismaAccountImportRepository(database.value);

    const result = await repository.createImportedAccount(
      "user-1",
      createPackage()
    );

    assert.equal(database.transactionCalls, 1);
    assert.equal(database.isolationLevel, "Serializable");
    assert.deepEqual(result.counts, {
      projects: 1,
      documents: 1,
      chats: 1,
      messages: 2,
      accountMemories: 2,
    });
    assert.equal(result.skippedAccountMemories, 2);
    assert.equal(database.state.projects[0]?.name, "Checkout (Imported 2)");
    assert.notEqual(database.state.projects[0]?.id, "source-project-1");
    assert.equal(database.state.members[0]?.role, "OWNER");
    assert.equal(database.state.projectMemories[0]?.source, "IMPORTED");
    assert.equal(database.state.documents[0]?.source, "IMPORTED");
    assert.notEqual(database.state.documents[0]?.id, "source-document-1");
    assert.equal(
      database.state.chats[0]?.projectId,
      database.state.projects[0]?.id
    );
    assert.notEqual(database.state.chats[0]?.id, "source-chat-1");
    assert.ok(
      database.state.messages.every(
        (message) => !["source-message-1", "source-message-2"].includes(String(message.id))
      )
    );
    assert.deepEqual(
      database.state.memories.map((memory) => memory.content),
      ["keep me", "Internal  Space"]
    );
  });

  it("rolls back every canonical write when a message write fails", async () => {
    const database = createFakeDatabase({ failMessages: true });
    const repository = createPrismaAccountImportRepository(database.value);

    await assert.rejects(
      () => repository.createImportedAccount("user-1", createPackage()),
      /canonical message write failed/
    );

    assert.equal(database.transactionCalls, 1);
    for (const records of Object.values(database.state)) {
      assert.deepEqual(records, []);
    }
  });
});

function createPackage(): ValidatedNativeAccountImport {
  return {
    importKind: "account_archive",
    packageDigest: "a".repeat(64),
    sourceAccountId: "source-account-1",
    warnings: [],
    accountMemories: [
      createMemory("source-memory-1", "Keep Me"),
      createMemory("source-memory-2", "keep me"),
      createMemory("source-memory-3", "Internal  Space"),
      createMemory("source-memory-4", " Internal  Space "),
    ],
    projects: [
      {
        sourceId: "source-project-1",
        name: "Checkout",
        description: "Imported project",
        instructions: { content: "Keep answers concise." },
        memory: { content: "Guest checkout is supported." },
        chatSourceIds: ["source-chat-1"],
        documents: [
          {
            sourceId: "source-document-1",
            title: "requirements.md",
            content: "# Requirements",
            mimeType: "text/markdown",
            metadata: { originalName: "requirements.md", sizeBytes: 14 },
            createdAt: new Date("2026-07-01T10:00:00.000Z"),
            updatedAt: new Date("2026-07-01T10:00:00.000Z"),
          },
        ],
      },
    ],
    chats: [
      {
        sourceId: "source-chat-1",
        sourceProjectId: "source-project-1",
        title: "Checkout chat",
        mode: "general",
        model: "gemini-3.1-flash-lite",
        createdAt: new Date("2026-07-01T11:00:00.000Z"),
        updatedAt: new Date("2026-07-01T11:05:00.000Z"),
        messages: [
          createMessage("source-message-1", "user", "Hello"),
          createMessage("source-message-2", "assistant", "Hi"),
        ],
      },
    ],
  };
}

function createMemory(sourceId: string, content: string) {
  return {
    sourceId,
    content,
    source: "USER_PROVIDED" as const,
    createdAt: new Date("2026-07-01T09:00:00.000Z"),
    updatedAt: new Date("2026-07-01T09:00:00.000Z"),
  };
}

function createMessage(
  sourceId: string,
  role: "user" | "assistant",
  content: string
) {
  return {
    sourceId,
    role,
    content,
    mode: "general",
    model: "gemini-3.1-flash-lite",
    attachments: [],
    isError: false,
    createdAt: new Date("2026-07-01T11:00:00.000Z"),
  };
}

function createFakeDatabase(options: { failMessages?: boolean } = {}) {
  const state = {
    memories: [] as Array<Record<string, unknown>>,
    projects: [] as Array<Record<string, unknown>>,
    members: [] as Array<Record<string, unknown>>,
    instructions: [] as Array<Record<string, unknown>>,
    projectMemories: [] as Array<Record<string, unknown>>,
    documents: [] as Array<Record<string, unknown>>,
    chats: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
  };
  let transactionCalls = 0;
  let isolationLevel: unknown;
  const tx = {
    project: {
      async findMany() {
        return [{ name: "Checkout (Imported)" }];
      },
      async create(args: { data: Record<string, unknown> }) {
        const record = { id: `new-project-${state.projects.length + 1}`, ...args.data };
        state.projects.push(record);
        return record;
      },
    },
    memory: {
      async findMany() {
        return [{ content: "  Keep Me  " }];
      },
      async create(args: { data: Record<string, unknown> }) {
        const record = { id: `new-memory-${state.memories.length + 1}`, ...args.data };
        state.memories.push(record);
        return record;
      },
    },
    projectMember: createModel(state.members, "member"),
    projectInstruction: createModel(state.instructions, "instruction"),
    projectMemory: createModel(state.projectMemories, "project-memory"),
    projectDocument: {
      async create(args: { data: Record<string, unknown> }) {
        const now = new Date("2026-07-03T12:00:00.000Z");
        const record = {
          id: `new-document-${state.documents.length + 1}`,
          contentHash: "",
          chunkingVersion: "",
          indexStatus: "PENDING",
          indexError: null,
          indexedAt: null,
          createdAt: now,
          updatedAt: now,
          ...args.data,
        };
        state.documents.push(record);
        return record;
      },
    },
    chat: {
      async create(args: { data: Record<string, unknown> }) {
        const record = { id: `new-chat-${state.chats.length + 1}`, ...args.data };
        state.chats.push(record);
        return record;
      },
    },
    message: {
      async createMany(args: { data: Array<Record<string, unknown>> }) {
        if (options.failMessages) throw new Error("canonical message write failed");
        for (const data of args.data) {
          state.messages.push({
            id: `new-message-${state.messages.length + 1}`,
            ...data,
          });
        }
        return { count: args.data.length };
      },
    },
  };
  const database = {
    async $transaction(
      callback: (transaction: typeof tx) => Promise<unknown>,
      options: { isolationLevel?: unknown }
    ) {
      transactionCalls += 1;
      isolationLevel = options.isolationLevel;
      const snapshot = Object.fromEntries(
        Object.entries(state).map(([key, value]) => [key, [...value]])
      ) as typeof state;

      try {
        return await callback(tx);
      } catch (error) {
        for (const key of Object.keys(state) as Array<keyof typeof state>) {
          state[key].splice(0, state[key].length, ...snapshot[key]);
        }
        throw error;
      }
    },
    projectDocument: {
      async findMany() {
        return state.documents.map((document) => ({
          id: String(document.id),
          indexStatus: "READY",
        }));
      },
    },
  };

  return {
    get isolationLevel() {
      return isolationLevel;
    },
    state,
    get transactionCalls() {
      return transactionCalls;
    },
    value: database as unknown as typeof prisma,
  };
}

function createModel(records: Array<Record<string, unknown>>, prefix: string) {
  return {
    async create(args: { data: Record<string, unknown> }) {
      const record = { id: `${prefix}-${records.length + 1}`, ...args.data };
      records.push(record);
      return record;
    },
  };
}
