import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemorySource } from "../src/generated/prisma/enums.ts";
import {
  computeAccountMemoryPackageDigest,
  createAccountMemoryExportPackage,
  validateAccountMemoryImportPackage,
} from "../src/modules/data-portability/account-memory-package.ts";
import { ACCOUNT_MEMORY_IMPORT_LIMITS } from "../src/modules/data-portability/account-memory-portability.types.ts";

describe("Account Memory portability package", () => {
  it("exports multiple canonical records and excludes non-portable sources", () => {
    const result = createAccountMemoryExportPackage(
      "user-1",
      [
        createRecord({
          id: "memory-1",
          source: MemorySource.USER_PROVIDED,
        }),
        createRecord({
          content: "Imported preference",
          id: "memory-2",
          source: MemorySource.IMPORTED,
        }),
        createRecord({
          content: "Derived suggestion",
          id: "memory-3",
          source: MemorySource.AI_EXTRACTED,
        }),
      ],
      new Date("2026-07-03T10:00:00.000Z")
    );
    const parsed = JSON.parse(result.payload.toString("utf8"));

    assert.equal(result.downloadFilename, "account-memories-export.json");
    assert.equal(parsed.formatVersion, "1.0");
    assert.equal(parsed.exportType, "account_memories");
    assert.equal(parsed.account.sourceUserId, "user-1");
    assert.deepEqual(Object.keys(parsed).sort(), [
      "account",
      "exportType",
      "exportedAt",
      "formatVersion",
      "memories",
      "warnings",
    ]);
    assert.deepEqual(
      parsed.memories.map((memory: { sourceId: string }) => memory.sourceId),
      ["memory-1", "memory-2"]
    );
    assert.deepEqual(
      parsed.memories.map((memory: { source: string }) => memory.source),
      ["USER_PROVIDED", "IMPORTED"]
    );
    assert.equal(parsed.warnings.length, 1);
    assert.doesNotMatch(
      result.payload.toString("utf8"),
      /password|session|token|usage|project|chat|document|embedding/i
    );
  });

  it("exports an empty memories array", () => {
    const result = createAccountMemoryExportPackage(
      "user-1",
      [],
      new Date("2026-07-03T10:00:00.000Z")
    );

    assert.deepEqual(result.document.memories, []);
    assert.deepEqual(result.document.warnings, []);
  });

  it("does not create an export that exceeds the import record limit", () => {
    assert.throws(
      () =>
        createAccountMemoryExportPackage(
          "user-1",
          Array.from(
            {
              length: ACCOUNT_MEMORY_IMPORT_LIMITS.maxRecords + 1,
            },
            (_, index) =>
              createRecord({
                content: `Memory ${index}`,
                id: `memory-${index}`,
              })
          ),
          new Date("2026-07-03T10:00:00.000Z")
        ),
      (error: unknown) =>
        Boolean(error) &&
        typeof error === "object" &&
        (error as { code?: unknown }).code ===
          "ACCOUNT_MEMORY_EXPORT_LIMIT_EXCEEDED"
    );
  });

  it("computes the digest from the exact raw JSON bytes", () => {
    const compact = createPayload({
      memories: [portableMemory("Memory")],
    });
    const spaced = Buffer.from(
      JSON.stringify(JSON.parse(compact.toString("utf8")), null, 2),
      "utf8"
    );

    assert.notEqual(
      computeAccountMemoryPackageDigest(compact),
      computeAccountMemoryPackageDigest(spaced)
    );
    assert.equal(
      validateAccountMemoryImportPackage(compact).packageDigest,
      computeAccountMemoryPackageDigest(compact)
    );
  });

  it("uses trim-only duplicate normalization inside the package", () => {
    const validated = validateAccountMemoryImportPackage(
      createPayload({
        memories: [
          portableMemory("  Alpha  ", "memory-1"),
          portableMemory("Alpha", "memory-2"),
          portableMemory("alpha", "memory-3"),
          portableMemory("A  B", "memory-4"),
          portableMemory("A B", "memory-5"),
        ],
      })
    );

    assert.equal(validated.packageRecords, 5);
    assert.equal(validated.intraPackageDuplicates, 1);
    assert.deepEqual(
      validated.memories.map((memory) => memory.content),
      ["Alpha", "alpha", "A  B", "A B"]
    );
  });

  it("rejects malformed, incompatible, and unexpected JSON safely", () => {
    const invalidPayloads = [
      Buffer.from("{", "utf8"),
      createPayload({
        formatVersion: "2.0",
      }),
      createPayload({
        exportType: "project",
      }),
      createPayload({
        unexpected: true,
      }),
      createPayload({
        memories: [
          {
            ...portableMemory("Memory"),
            source: "AI_EXTRACTED",
          },
        ],
      }),
    ];

    for (const payload of invalidPayloads) {
      assert.throws(
        () => validateAccountMemoryImportPackage(payload),
        hasInvalidPackageCode
      );
    }
  });

  it("enforces payload, record-count, and per-record content limits", () => {
    assert.throws(
      () =>
        validateAccountMemoryImportPackage(
          Buffer.alloc(ACCOUNT_MEMORY_IMPORT_LIMITS.maxPayloadBytes + 1, 32)
        ),
      hasInvalidPackageCode
    );
    assert.throws(
      () =>
        validateAccountMemoryImportPackage(
          createPayload({
            memories: Array.from(
              {
                length: ACCOUNT_MEMORY_IMPORT_LIMITS.maxRecords + 1,
              },
              (_, index) => portableMemory(`Memory ${index}`, `memory-${index}`)
            ),
          })
        ),
      hasInvalidPackageCode
    );
    assert.throws(
      () =>
        validateAccountMemoryImportPackage(
          createPayload({
            memories: [
              portableMemory(
                "x".repeat(
                  ACCOUNT_MEMORY_IMPORT_LIMITS.maxContentChars + 1
                )
              ),
            ],
          })
        ),
      hasInvalidPackageCode
    );
  });
});

function createPayload(
  overrides: Record<string, unknown> = {}
) {
  return Buffer.from(
    JSON.stringify({
      formatVersion: "1.0",
      exportType: "account_memories",
      exportedAt: "2026-07-03T10:00:00.000Z",
      account: {
        sourceUserId: "source-user-1",
      },
      memories: [],
      warnings: [],
      ...overrides,
    }),
    "utf8"
  );
}

function portableMemory(content: string, sourceId = "memory-1") {
  return {
    sourceId,
    content,
    source: "USER_PROVIDED",
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T09:30:00.000Z",
  };
}

function createRecord(
  overrides: Partial<{
    id: string;
    content: string;
    source: MemorySource;
  }> = {}
) {
  return {
    id: "memory-1",
    content: "Prefer concise QA answers",
    source: MemorySource.USER_PROVIDED,
    createdAt: new Date("2026-07-03T09:00:00.000Z"),
    updatedAt: new Date("2026-07-03T09:30:00.000Z"),
    ...overrides,
  };
}

function hasInvalidPackageCode(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: unknown }).code ===
      "ACCOUNT_MEMORY_IMPORT_PACKAGE_INVALID"
  );
}
