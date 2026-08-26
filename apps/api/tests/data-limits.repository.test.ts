import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_LIMITS } from "../src/config/data-limits.ts";
import { prisma } from "../src/db/prisma.ts";
import { createPrismaChatHistoryRepository } from "../src/modules/chat-history/chat-history.repository.ts";
import { createPrismaMemoryRepository } from "../src/modules/memory/memory.repository.ts";
import { createPrismaProjectDocumentsRepository } from "../src/modules/project-documents/project-documents.repository.ts";
import { createPrismaProjectsRepository } from "../src/modules/projects/projects.repository.ts";

const NOW = new Date("2026-08-19T10:00:00.000Z");

describe("database growth limits", () => {
  it("rejects a new chat once the per-user quota is full", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      chat: {
        async count() { return DATA_LIMITS.chatsPerUser; },
        async findUnique() { return null; },
        async create() { created = true; return {}; },
      },
    };
    const repository = createPrismaChatHistoryRepository(transactionDatabase(tx));

    await assert.rejects(
      () => repository.saveUserChat({
        chat: {
          id: "new-chat",
          projectId: null,
          title: "New chat",
          mode: "general",
          model: "gemini-3.1-flash-lite",
          messages: [],
        },
        createdAt: NOW,
        messages: [],
        updatedAt: NOW,
        userId: "user-1",
      }),
      (error: unknown) => hasCode(error, "CHAT_LIMIT_REACHED")
    );
    assert.equal(created, false);
  });

  it("rejects a new project once the per-user quota is full", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      project: {
        async count() { return DATA_LIMITS.projectsPerUser; },
        async create() { created = true; return {}; },
      },
      projectMember: { async create() { return {}; } },
    };
    const repository = createPrismaProjectsRepository(transactionDatabase(tx));

    await assert.rejects(
      () => repository.createUserProject({
        description: null,
        name: "Overflow project",
        ownerId: "user-1",
      }),
      (error: unknown) => hasCode(error, "PROJECT_LIMIT_REACHED")
    );
    assert.equal(created, false);
  });

  it("rejects oversized message snapshots at the repository boundary", async () => {
    let updated = false;
    const tx = {
      async $executeRaw() { return 1; },
      chat: {
        async findUnique() { return { userId: "user-1" }; },
        async update() { updated = true; return {}; },
      },
    };
    const repository = createPrismaChatHistoryRepository(transactionDatabase(tx));

    await assert.rejects(
      () => repository.saveUserChat({
        chat: {
          id: "chat-1",
          projectId: null,
          title: "Oversized chat",
          mode: "general",
          model: "gemini-3.1-flash-lite",
          messages: [],
        },
        createdAt: NOW,
        messages: Array.from({ length: DATA_LIMITS.messagesPerChat + 1 }, (_, index) => ({
          id: `message-${index}`,
          role: "USER" as const,
          content: "message",
          mode: "general",
          model: "gemini-3.1-flash-lite",
          assetAttachments: [],
          createdAt: NOW,
        })),
        updatedAt: NOW,
        userId: "user-1",
      }),
      (error: unknown) => hasCode(error, "CHAT_MESSAGE_LIMIT_REACHED")
    );
    assert.equal(updated, false);
  });

  it("rejects a project-document batch atomically when it would exceed the quota", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      projectDocument: {
        async count() { return DATA_LIMITS.documentsPerProject - 1; },
        async create() { created = true; return {}; },
      },
      storedAsset: { async findMany() { return []; } },
    };
    const repository = createPrismaProjectDocumentsRepository(transactionDatabase(tx));

    await assert.rejects(
      () => repository.createProjectDocuments([
        projectDocumentInput("one"),
        projectDocumentInput("two"),
      ]),
      (error: unknown) => hasCode(error, "PROJECT_DOCUMENT_LIMIT_REACHED")
    );
    assert.equal(created, false);
  });

  it("rejects a new account memory once the per-user quota is full", async () => {
    let created = false;
    const tx = {
      async $executeRaw() { return 1; },
      memory: {
        async count() { return DATA_LIMITS.accountMemoriesPerUser; },
        async create() { created = true; return {}; },
      },
    };
    const repository = createPrismaMemoryRepository(transactionDatabase(tx));

    await assert.rejects(
      () => repository.createAccountMemory({ content: "Overflow", userId: "user-1" }),
      (error: unknown) => hasCode(error, "MEMORY_LIMIT_REACHED")
    );
    assert.equal(created, false);
  });

  it("bounds every collection query by the same enforced quota", async () => {
    const calls: Record<string, any> = {};
    const database = {
      chat: { async findMany(input: any) { calls.chats = input; return []; } },
      memory: { async findMany(input: any) { calls.memories = input; return []; } },
      project: { async findMany(input: any) { calls.projects = input; return []; } },
      projectDocument: { async findMany(input: any) { calls.documents = input; return []; } },
    } as unknown as typeof prisma;

    await createPrismaChatHistoryRepository(database).listUserChats("user-1");
    await createPrismaMemoryRepository(database).listAccountMemories("user-1");
    await createPrismaProjectsRepository(database).listUserProjects("user-1");
    await createPrismaProjectDocumentsRepository(database).listProjectDocuments("project-1");

    assert.equal(calls.chats.take, DATA_LIMITS.chatsPerUser);
    assert.equal(calls.chats.include.messages.take, DATA_LIMITS.messagesPerChat);
    assert.equal(calls.memories.take, DATA_LIMITS.accountMemoriesPerUser);
    assert.equal(calls.projects.take, DATA_LIMITS.projectsPerUser);
    assert.equal(calls.documents.take, DATA_LIMITS.documentsPerProject);
  });
});

function transactionDatabase<T extends object>(tx: T) {
  return {
    async $transaction(callback: (transaction: T) => Promise<unknown>) {
      return callback(tx);
    },
  } as unknown as typeof prisma;
}

function projectDocumentInput(suffix: string) {
  return {
    content: `Document ${suffix}`,
    projectId: "project-1",
    title: `Document ${suffix}`,
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
