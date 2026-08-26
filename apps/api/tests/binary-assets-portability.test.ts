import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { StoredObjectSample } from "../src/modules/assets/assets.types.ts";
import {
  BINARY_ASSET_PORTABILITY_LIMITS,
  collectPortableBinaryAssets,
  validatePortableBinaryAssets,
  type PortableBinaryAssetSource,
} from "../src/modules/data-portability/binary-assets.ts";

const BYTES = new TextEncoder().encode("portable private bytes");
const SHA256 = createHash("sha256").update(BYTES).digest("base64");

describe("binary asset portability boundary", () => {
  it("collects owned READY bytes with deterministic safe paths and round-trips validation", async () => {
    const reads: Array<{ objectKey: string; maximumBytes: number }> = [];
    const collected = await collectPortableBinaryAssets(
      "user-1",
      [readySource()],
      {
        async readObject(objectKey, maximumBytes) {
          reads.push({ objectKey, maximumBytes });
          return storedObject();
        },
      }
    );

    assert.deepEqual(reads, [
      { objectKey: "chat-attachments/2026/08/asset-1", maximumBytes: 4 * 1024 * 1024 },
    ]);
    assert.equal(collected.totalBytes, BYTES.byteLength);
    assert.equal(collected.assets[0]?.file.path, "assets/001-screen-shot.txt");
    assert.equal(collected.assets[0]?.file.sha256, hashHex(BYTES));
    assert.equal(collected.entries.get("assets/001-screen-shot.txt"), BYTES);

    const validated = validatePortableBinaryAssets(
      collected.assets,
      Object.fromEntries(collected.entries)
    );
    assert.equal(validated.length, 1);
    assert.equal(validated[0]?.binding.kind, "message_attachment");
    assert.deepEqual(validated[0]?.bytes, BYTES);
  });

  it("processes the exact maximum asset count and byte ceiling sequentially", async () => {
    const bytesPerAsset =
      BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes /
      BINARY_ASSET_PORTABILITY_LIMITS.maxAssets;
    assert.equal(Number.isSafeInteger(bytesPerAsset), true);

    const bytes = new Uint8Array(bytesPerAsset).fill(0x61);
    const checksumSha256 = createHash("sha256")
      .update(bytes)
      .digest("base64");
    const sources = Array.from(
      { length: BINARY_ASSET_PORTABILITY_LIMITS.maxAssets },
      (_value, index) =>
        readySource({
          binding: {
            kind: "message_attachment",
            ordinal: 0,
            sourceMessageId: `message-${index + 1}`,
          },
          checksumSha256,
          expectedSizeBytes: bytes.byteLength,
          id: `asset-${index + 1}`,
          objectKey: `chat-attachments/scale/asset-${index + 1}`,
          originalName: `asset-${index + 1}.txt`,
          sizeBytes: bytes.byteLength,
        })
    );
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    let readCount = 0;

    const collected = await collectPortableBinaryAssets(
      "user-1",
      sources,
      {
        async readObject(_objectKey, maximumBytes) {
          readCount += 1;
          activeReads += 1;
          maximumConcurrentReads = Math.max(
            maximumConcurrentReads,
            activeReads
          );
          assert.equal(
            maximumBytes,
            BINARY_ASSET_PORTABILITY_LIMITS.maxAssetBytes
          );
          await Promise.resolve();
          activeReads -= 1;
          return {
            bytes,
            metadata: {
              checksumSha256,
              contentLength: bytes.byteLength,
              contentType: "text/plain",
              etag: "scale-etag",
            },
          };
        },
      }
    );

    assert.equal(readCount, BINARY_ASSET_PORTABILITY_LIMITS.maxAssets);
    assert.equal(maximumConcurrentReads, 1);
    assert.equal(
      collected.totalBytes,
      BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes
    );
    assert.equal(
      collected.assets.at(-1)?.file.path,
      "assets/064-asset-64.txt"
    );
    assert.equal(
      validatePortableBinaryAssets(
        collected.assets,
        Object.fromEntries(collected.entries)
      ).length,
      BINARY_ASSET_PORTABILITY_LIMITS.maxAssets
    );
  });

  it("rejects wrong-owner and duplicate bindings before any storage read", async () => {
    let reads = 0;
    const storage = {
      async readObject() {
        reads += 1;
        return storedObject();
      },
    };

    await assert.rejects(
      () => collectPortableBinaryAssets("user-2", [readySource()], storage),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_UNAVAILABLE")
    );
    await assert.rejects(
      () =>
        collectPortableBinaryAssets(
          "user-1",
          [readySource(), readySource({ id: "asset-2", objectKey: "key-2" })],
          storage
        ),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_UNAVAILABLE")
    );
    assert.equal(reads, 0);
  });

  it("fails closed when stored bytes or object metadata no longer match the validated record", async () => {
    await assert.rejects(
      () =>
        collectPortableBinaryAssets("user-1", [readySource()], {
          async readObject() {
            return {
              ...storedObject(),
              bytes: new TextEncoder().encode("tampered"),
            };
          },
        }),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_UNAVAILABLE")
    );

    await assert.rejects(
      () =>
        collectPortableBinaryAssets("user-1", [readySource()], {
          async readObject() {
            return {
              ...storedObject(),
              metadata: {
                ...storedObject().metadata,
                contentType: "image/png",
              },
            };
          },
        }),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_UNAVAILABLE")
    );
  });

  it("enforces count, per-file, and total limits before reading", async () => {
    const limits = {
      maxAssetBytes: BYTES.byteLength,
      maxAssets: 1,
      maxPathChars: 240,
      maxTotalBytes: BYTES.byteLength,
    };
    let reads = 0;

    await assert.rejects(
      () =>
        collectPortableBinaryAssets(
          "user-1",
          [readySource(), readySource({
            binding: { kind: "message_attachment", ordinal: 1, sourceMessageId: "message-1" },
            id: "asset-2",
            objectKey: "key-2",
          })],
          { async readObject() { reads += 1; return storedObject(); } },
          limits
        ),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_TOO_LARGE")
    );
    assert.equal(reads, 0);
  });

  it("rejects tampered bytes, duplicate bindings, and purpose mismatches on import", async () => {
    const collected = await collectPortableBinaryAssets(
      "user-1",
      [readySource()],
      { async readObject() { return storedObject(); } }
    );
    const entries = Object.fromEntries(collected.entries);

    assert.throws(
      () => validatePortableBinaryAssets(collected.assets, {
        ...entries,
        [collected.assets[0]!.file.path]: new TextEncoder().encode("tampered"),
      }),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_PACKAGE_INVALID")
    );
    assert.throws(
      () => validatePortableBinaryAssets([
        collected.assets[0],
        { ...collected.assets[0], sourceAssetId: "asset-2", file: {
          ...collected.assets[0]!.file,
          path: "assets/002-copy.png",
        } },
      ], {
        ...entries,
        "assets/002-copy.png": BYTES,
      }),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_PACKAGE_INVALID")
    );
    assert.throws(
      () => validatePortableBinaryAssets([
        { ...collected.assets[0], purpose: "PROJECT_DOCUMENT_SOURCE" },
      ], entries),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_PACKAGE_INVALID")
    );
    assert.throws(
      () => validatePortableBinaryAssets([
        {
          ...collected.assets[0],
          mimeType: "image/png",
          originalName: "screen-shot.png",
        },
      ], entries),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_PACKAGE_INVALID")
    );
  });
});

function readySource(
  overrides: Partial<PortableBinaryAssetSource> = {}
): PortableBinaryAssetSource {
  return {
    binding: {
      kind: "message_attachment",
      ordinal: 0,
      sourceMessageId: "message-1",
    },
    checksumSha256: SHA256,
    createdAt: new Date("2026-08-23T12:00:00.000Z"),
    declaredMimeType: "text/plain",
    detectedMimeType: "text/plain",
    etag: "etag-1",
    expectedSizeBytes: BYTES.byteLength,
    id: "asset-1",
    objectKey: "chat-attachments/2026/08/asset-1",
    originalName: "screen shot.txt",
    ownerId: "user-1",
    projectId: "project-1",
    purpose: "CHAT_ATTACHMENT",
    readyAt: new Date("2026-08-23T12:01:00.000Z"),
    sizeBytes: BYTES.byteLength,
    status: "READY",
    updatedAt: new Date("2026-08-23T12:01:00.000Z"),
    uploadExpiresAt: null,
    validationStartedAt: null,
    ...overrides,
  };
}

function storedObject(): StoredObjectSample {
  return {
    bytes: BYTES,
    metadata: {
      checksumSha256: SHA256,
      contentLength: BYTES.byteLength,
      contentType: "text/plain",
      etag: "etag-1",
    },
  };
}

function hashHex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).code === code
  );
}
