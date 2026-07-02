import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemorySource } from "../src/generated/prisma/enums.ts";
import type { AccountMemoryPortabilityRepository } from "../src/modules/data-portability/account-memory-portability.repository.ts";
import { createAccountMemoryPortabilityService } from "../src/modules/data-portability/account-memory-portability.service.ts";
import type {
  AccountMemoryPortabilityRecord,
  PortableAccountMemoryRecord,
} from "../src/modules/data-portability/account-memory-portability.types.ts";

describe("Account Memory portability service", () => {
  it("exports only the authenticated user's Account Memory records", async () => {
    const repository = createFakeRepository([
      createRecord({
        content: "User one memory",
        id: "memory-1",
        userId: "user-1",
      }),
      createRecord({
        content: "Another user's memory",
        id: "memory-2",
        userId: "user-2",
      }),
    ]);
    const service = createService(repository);

    const result = await service.exportAccountMemories("user-1");

    assert.deepEqual(
      result.document.memories.map((memory) => memory.content),
      ["User one memory"]
    );
    assert.deepEqual(repository.listUserIds, ["user-1"]);
  });

  it("previews import counts without database writes", async () => {
    const repository = createFakeRepository([
      createRecord({
        content: "Existing memory",
        userId: "user-1",
      }),
    ]);
    const service = createService(repository);
    const payload = createPayload([
      portableMemory(" Existing memory ", "source-1"),
      portableMemory("New memory", "source-2"),
      portableMemory("New memory", "source-3"),
      portableMemory("new memory", "source-4"),
      portableMemory("New  memory", "source-5"),
    ]);

    const preview = await service.previewAccountMemoryImport(
      "user-1",
      payload
    );

    assert.deepEqual(preview.counts, {
      packageRecords: 5,
      importableRecords: 3,
      exactDuplicates: 2,
    });
    assert.equal(preview.currentMemoryCount, 1);
    assert.equal(repository.importCalls.length, 0);
  });

  it("rejects a digest mismatch before the import transaction", async () => {
    const repository = createFakeRepository();
    const service = createService(repository);

    await assert.rejects(
      () =>
        service.commitAccountMemoryImport(
          "user-1",
          createPayload([portableMemory("New memory")]),
          "a".repeat(64)
        ),
      {
        code: "ACCOUNT_MEMORY_IMPORT_DIGEST_MISMATCH",
      }
    );
    assert.equal(repository.importCalls.length, 0);
  });

  it("creates new imported records and never reuses package trace fields", async () => {
    const repository = createFakeRepository();
    const service = createService(repository);
    const payload = createPayload([
      {
        ...portableMemory("  Imported memory  ", "source-memory-99"),
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-02T00:00:00.000Z",
      },
    ]);
    const preview = await service.previewAccountMemoryImport(
      "user-1",
      payload
    );

    const result = await service.commitAccountMemoryImport(
      "user-1",
      payload,
      preview.packageDigest
    );

    assert.deepEqual(result.imported, {
      memories: 1,
      skippedDuplicates: 0,
    });
    assert.equal(repository.memories[0]?.record.content, "Imported memory");
    assert.equal(repository.memories[0]?.record.source, MemorySource.IMPORTED);
    assert.notEqual(repository.memories[0]?.record.id, "source-memory-99");
    assert.notEqual(
      repository.memories[0]?.record.createdAt.toISOString(),
      "2000-01-01T00:00:00.000Z"
    );
  });

  it("recomputes duplicates at commit when memory changed after Preview", async () => {
    const repository = createFakeRepository();
    const service = createService(repository);
    const payload = createPayload([portableMemory("Race memory")]);
    const preview = await service.previewAccountMemoryImport(
      "user-1",
      payload
    );

    repository.memories.push({
      record: createRecord({
        content: "Race memory",
        id: "memory-added-after-preview",
        userId: "user-1",
      }),
      userId: "user-1",
    });

    const result = await service.commitAccountMemoryImport(
      "user-1",
      payload,
      preview.packageDigest
    );

    assert.deepEqual(result.imported, {
      memories: 0,
      skippedDuplicates: 1,
    });
    assert.equal(result.currentMemoryCount, 1);
    assert.equal(repository.memories.length, 1);
  });

  it("skips package duplicates without replacing or deleting existing memory", async () => {
    const repository = createFakeRepository([
      createRecord({
        content: "Keep existing",
        id: "existing-memory",
        userId: "user-1",
      }),
    ]);
    const service = createService(repository);
    const payload = createPayload([
      portableMemory("New memory", "source-1"),
      portableMemory(" New memory ", "source-2"),
      portableMemory("Keep existing", "source-3"),
    ]);
    const preview = await service.previewAccountMemoryImport(
      "user-1",
      payload
    );

    const result = await service.commitAccountMemoryImport(
      "user-1",
      payload,
      preview.packageDigest
    );

    assert.deepEqual(result.imported, {
      memories: 1,
      skippedDuplicates: 2,
    });
    assert.deepEqual(
      repository.memories.map((memory) => memory.record.content),
      ["Keep existing", "New memory"]
    );
  });
});

interface StoredFakeMemory {
  record: AccountMemoryPortabilityRecord;
  userId: string;
}

interface FakeRepository extends AccountMemoryPortabilityRepository {
  importCalls: Array<{
    userId: string;
    memories: PortableAccountMemoryRecord[];
  }>;
  listUserIds: string[];
  memories: StoredFakeMemory[];
}

function createFakeRepository(
  initialMemories: Array<
    AccountMemoryPortabilityRecord & {
      userId: string;
    }
  > = []
): FakeRepository {
  const repository: FakeRepository = {
    importCalls: [],
    listUserIds: [],
    memories: initialMemories.map(({ userId, ...record }) => ({
      record,
      userId,
    })),

    async importAccountMemories(userId, memories) {
      repository.importCalls.push({
        userId,
        memories,
      });
      const currentMemories = repository.memories.filter(
        (memory) => memory.userId === userId
      );
      const normalizedContents = new Set(
        currentMemories.map((memory) => memory.record.content.trim())
      );
      let created = 0;
      let skippedExistingDuplicates = 0;

      for (const memory of memories) {
        const content = memory.content.trim();

        if (normalizedContents.has(content)) {
          skippedExistingDuplicates += 1;
          continue;
        }

        repository.memories.push({
          record: createRecord({
            content,
            id: `new-memory-${repository.memories.length + 1}`,
            source: MemorySource.IMPORTED,
            userId,
          }),
          userId,
        });
        normalizedContents.add(content);
        created += 1;
      }

      return {
        created,
        skippedExistingDuplicates,
        currentMemoryCount: currentMemories.length + created,
      };
    },

    async listAccountMemories(userId) {
      repository.listUserIds.push(userId);

      return repository.memories
        .filter((memory) => memory.userId === userId)
        .map((memory) => memory.record);
    },
  };

  return repository;
}

function createService(repository: AccountMemoryPortabilityRepository) {
  return createAccountMemoryPortabilityService({
    now: () => new Date("2026-07-03T10:00:00.000Z"),
    repository,
  });
}

function createPayload(memories: PortableAccountMemoryRecord[]) {
  return Buffer.from(
    JSON.stringify({
      formatVersion: "1.0",
      exportType: "account_memories",
      exportedAt: "2026-07-03T10:00:00.000Z",
      account: {
        sourceUserId: "source-user-1",
      },
      memories,
      warnings: [],
    }),
    "utf8"
  );
}

function portableMemory(
  content: string,
  sourceId = "source-memory-1"
): PortableAccountMemoryRecord {
  return {
    sourceId,
    content,
    source: "USER_PROVIDED",
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:30:00.000Z",
  };
}

function createRecord(
  overrides: Partial<
    AccountMemoryPortabilityRecord & {
      userId: string;
    }
  > = {}
) {
  return {
    id: "memory-1",
    content: "Memory",
    source: MemorySource.USER_PROVIDED,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: "user-1",
    ...overrides,
  };
}
