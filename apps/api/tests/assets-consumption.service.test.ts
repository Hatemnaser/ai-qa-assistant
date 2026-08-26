import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createAssetConsumptionService } from "../src/modules/assets/assets-consumption.service.ts";
import type { AssetStorage } from "../src/modules/assets/assets.storage.ts";
import type { AssetRecord, AssetsRepository } from "../src/modules/assets/assets.types.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const HELLO_BYTES = new TextEncoder().encode("hello");
const HELLO_CHECKSUM = createHash("sha256").update(HELLO_BYTES).digest("base64");

describe("private asset consumption", () => {
  it("returns and reads only an exact READY owner/purpose/project match", async () => {
    const asset = readyAsset();
    const maximums: number[] = [];
    const service = createService(asset, {
      async readObject(_objectKey, maximumBytes) {
        maximums.push(maximumBytes);
        return {
          bytes: HELLO_BYTES,
          metadata: {
            checksumSha256: asset.checksumSha256,
            contentLength: 5,
            contentType: "text/plain",
            etag: "etag",
          },
        };
      },
    });

    const result = await service.readReadyOwnedAsset({
      assetId: "asset-1",
      ownerId: "user-1",
      projectId: "project-1",
      purpose: "PROJECT_DOCUMENT_SOURCE",
    });

    assert.equal(result.asset.id, "asset-1");
    assert.equal(new TextDecoder().decode(result.bytes), "hello");
    assert.deepEqual(maximums, [5]);
  });

  it("does not reveal whether owner, status, purpose, or project caused rejection", async () => {
    const cases: Array<{ asset: AssetRecord | null; input: Parameters<ReturnType<typeof createService>["getReadyOwnedAsset"]>[0] }> = [
      {
        asset: null,
        input: request({ ownerId: "foreign-user" }),
      },
      {
        asset: readyAsset({ status: "PENDING", readyAt: null }),
        input: request(),
      },
      {
        asset: readyAsset({ purpose: "CHAT_ATTACHMENT" }),
        input: request(),
      },
      {
        asset: readyAsset({ projectId: "other-project" }),
        input: request(),
      },
    ];

    for (const testCase of cases) {
      const service = createService(testCase.asset);
      await assert.rejects(
        () => service.getReadyOwnedAsset(testCase.input),
        (error: unknown) => hasError(error, 404, "ASSET_NOT_FOUND")
      );
    }
  });

  it("fails closed when storage is disabled or a full object read is incomplete", async () => {
    const disabled = createService(readyAsset(), {}, false);
    await assert.rejects(
      () => disabled.getReadyOwnedAsset(request()),
      (error: unknown) => hasError(error, 503, "ASSET_STORAGE_DISABLED")
    );

    const truncated = createService(readyAsset(), {
      async readObject() {
        return {
          bytes: new Uint8Array([1]),
          metadata: {
            checksumSha256: null,
            contentLength: 1,
            contentType: "text/plain",
            etag: null,
          },
        };
      },
    });
    await assert.rejects(
      () => truncated.readReadyOwnedAsset(request()),
      (error: unknown) => hasError(error, 503, "ASSET_READ_UNAVAILABLE")
    );

    const replacedWithSameLength = createService(readyAsset(), {
      async readObject() {
        return {
          bytes: new TextEncoder().encode("HELLO"),
          metadata: {
            checksumSha256: null,
            contentLength: 5,
            contentType: "text/plain",
            etag: null,
          },
        };
      },
    });
    await assert.rejects(
      () => replacedWithSameLength.readReadyOwnedAsset(request()),
      (error: unknown) => hasError(error, 503, "ASSET_READ_UNAVAILABLE")
    );
  });
});

function createService(
  asset: AssetRecord | null,
  storageOverrides: Partial<AssetStorage> = {},
  enabled = true
) {
  const repository = {
    async findOwnedAsset(ownerId: string, assetId: string) {
      return asset?.ownerId === ownerId && asset.id === assetId ? asset : null;
    },
  } as AssetsRepository;
  const storage = {
    async createDownloadUrl() { return ""; },
    async createUploadUrl() { return { headers: {}, url: "" }; },
    async deleteObject() {},
    async inspectObject() {
      return { checksumSha256: null, contentLength: 0, contentType: null, etag: null };
    },
    async readObject() { throw new Error("not used"); },
    async readObjectSample() {
      return {
        bytes: new TextEncoder().encode("hello"),
        metadata: { checksumSha256: null, contentLength: 5, contentType: "text/plain", etag: null },
      };
    },
    async writeObject() { throw new Error("not used"); },
    ...storageOverrides,
  } as AssetStorage;

  return createAssetConsumptionService({ enabled: () => enabled, repository, storage });
}

function request(overrides: Partial<{
  assetId: string;
  ownerId: string;
  projectId: string | null;
  purpose: "PROJECT_DOCUMENT_SOURCE";
}> = {}) {
  return {
    assetId: "asset-1",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE" as const,
    ...overrides,
  };
}

function readyAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    checksumSha256: HELLO_CHECKSUM,
    createdAt: NOW,
    declaredMimeType: "text/plain",
    detectedMimeType: "text/plain",
    etag: "etag",
    expectedSizeBytes: 5,
    id: "asset-1",
    objectKey: "project-documents/2026/08/12/opaque",
    originalName: "notes.txt",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE",
    readyAt: NOW,
    sizeBytes: 5,
    status: "READY",
    updatedAt: NOW,
    uploadExpiresAt: null,
    validationStartedAt: null,
    ...overrides,
  };
}

function hasError(error: unknown, statusCode: number, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "statusCode" in error &&
      error.statusCode === statusCode &&
      "code" in error &&
      error.code === code
  );
}
