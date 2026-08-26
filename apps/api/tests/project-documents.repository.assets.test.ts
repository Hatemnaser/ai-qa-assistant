import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createPrismaProjectDocumentsRepository } from "../src/modules/project-documents/project-documents.repository.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

describe("project document source asset linking", () => {
  it("revalidates and locks a READY owner/project/purpose match in the create transaction", async () => {
    const harness = createHarness();
    const repository = createPrismaProjectDocumentsRepository(harness.database);

    const [document] = await repository.createProjectDocuments([storedInput()]);

    assert.equal(document?.sourceAssetId, "asset-1");
    assert.equal(harness.lockCalls, 2);
    assert.deepEqual(harness.created[0]?.data.sourceAssetId, "asset-1");
    assert.equal("sourceAssetOwnerId" in harness.created[0].data, false);
  });

  it("rejects foreign, non-ready, wrong-purpose, wrong-project, and already-linked sources", async () => {
    const cases = [
      { ownerId: "other-user" },
      { status: "PENDING" },
      { purpose: "CHAT_ATTACHMENT" },
      { projectId: "other-project" },
    ];

    for (const overrides of cases) {
      const harness = createHarness(overrides);
      const repository = createPrismaProjectDocumentsRepository(harness.database);
      await assert.rejects(
        () => repository.createProjectDocuments([storedInput()]),
        (error: unknown) => hasCode(error, "ASSET_NOT_FOUND")
      );
      assert.equal(harness.created.length, 0);
    }

    const linked = createHarness({ sourceDocument: { id: "document-existing" } });
    await assert.rejects(
      () => createPrismaProjectDocumentsRepository(linked.database)
        .createProjectDocuments([storedInput()]),
      (error: unknown) => hasCode(error, "ASSET_ALREADY_ATTACHED")
    );
  });
});

function createHarness(overrides: Record<string, unknown> = {}) {
  let lockCalls = 0;
  const created: Array<any> = [];
  const asset = {
    id: "asset-1",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE",
    sourceDocument: null,
    status: "READY",
    ...overrides,
  };
  const tx = {
    async $executeRaw() { lockCalls += 1; return 1; },
    storedAsset: {
      async findMany() { return [asset]; },
    },
    projectDocument: {
      async count() { return 0; },
      async create(input: any) {
        created.push(input);
        return {
          ...input.data,
          chunkingVersion: "",
          contentHash: "",
          createdAt: NOW,
          id: "document-1",
          indexError: null,
          indexedAt: null,
          indexStatus: "PENDING",
          metadata: input.data.metadata || null,
          updatedAt: NOW,
        };
      },
    },
  };
  const database = {
    async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) {
      return callback(tx);
    },
  } as unknown as typeof prisma;

  return {
    created,
    database,
    get lockCalls() { return lockCalls; },
  };
}

function storedInput() {
  return {
    content: "# Requirements",
    metadata: { originalName: "requirements.md", sizeBytes: 14 },
    mimeType: "text/markdown",
    projectId: "project-1",
    source: "IMPORTED" as const,
    sourceAssetId: "asset-1",
    sourceAssetOwnerId: "user-1",
    title: "requirements.md",
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
