import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createBinaryAssetRestoreService } from "../src/modules/data-portability/binary-asset-restore.service.ts";
import type { BinaryAssetRestoreRepository } from "../src/modules/data-portability/binary-asset-restore.types.ts";
import {
  BINARY_ASSET_PORTABILITY_LIMITS,
  type ValidatedPortableBinaryAsset,
} from "../src/modules/data-portability/binary-assets.ts";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("binary asset restore scale boundary", () => {
  it("restores 64 assets totaling exactly 8 MiB with sequential bounded writes", async () => {
    const assetCount = BINARY_ASSET_PORTABILITY_LIMITS.maxAssets;
    const bytesPerAsset =
      BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes / assetCount;
    assert.equal(Number.isSafeInteger(bytesPerAsset), true);

    const bytes = new Uint8Array(bytesPerAsset).fill(0x61);
    const checksumSha256 = createHash("sha256")
      .update(bytes)
      .digest("base64");
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const assets = Array.from({ length: assetCount }, (_, index) =>
      validatedAsset(index, bytes, checksumSha256, fileSha256)
    );

    let assetSequence = 0;
    let objectSequence = 0;
    let activeWrites = 0;
    let maximumConcurrentWrites = 0;
    let stageCalls = 0;
    let assertionCalls = 0;
    let commitCalls = 0;
    const writtenKeys: string[] = [];

    const repository: BinaryAssetRestoreRepository = {
      async assertAttemptActive(_ownerId, reservations) {
        assertionCalls += 1;
        assert.equal(reservations.length, assetCount);
        return true;
      },
      async markForCleanup() {
        throw new Error("successful maximum-scale restore must not schedule cleanup");
      },
      async stage(_ownerId, reservations, startedAt, cleanupNotBefore, quota) {
        stageCalls += 1;
        assert.equal(reservations.length, assetCount);
        assert.equal(startedAt.toISOString(), NOW.toISOString());
        assert.equal(
          cleanupNotBefore.toISOString(),
          "2026-08-25T12:30:00.000Z"
        );
        assert.equal(quota, BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes);
        assert.equal(
          reservations.reduce(
            (total, reservation) => total + reservation.descriptor.sizeBytes,
            0
          ),
          BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes
        );
        assert.equal(
          new Set(reservations.map((reservation) => reservation.assetId)).size,
          assetCount
        );
        assert.equal(
          new Set(reservations.map((reservation) => reservation.objectKey)).size,
          assetCount
        );
      },
    };

    const service = createBinaryAssetRestoreService({
      config: {
        assetUserQuotaBytes: BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes,
        privateAssetsEnabled: true,
      },
      createAssetId: () => `restored-asset-${assetSequence++}`,
      createAttemptToken: () => "scale-attempt-token",
      createObjectKey: () => `project-documents/scale-${objectSequence++}`,
      createSessionId: () => "scale-restore-session",
      now: () => NOW,
      repository,
      storage: {
        async writeObject(input) {
          activeWrites += 1;
          maximumConcurrentWrites = Math.max(
            maximumConcurrentWrites,
            activeWrites
          );
          try {
            assert.equal(input.bytes.byteLength, bytesPerAsset);
            assert.equal(
              input.maximumBytes,
              BINARY_ASSET_PORTABILITY_LIMITS.maxAssetBytes
            );
            writtenKeys.push(input.objectKey);
            await Promise.resolve();
            return {
              checksumSha256: input.checksumSha256,
              contentLength: input.bytes.byteLength,
              contentType: input.contentType,
              etag: `etag-${writtenKeys.length}`,
            };
          } finally {
            activeWrites -= 1;
          }
        },
      },
    });

    const result = await service.runWithPreparedAssets(
      "scale-user",
      assets,
      async (uploaded) => {
        commitCalls += 1;
        assert.equal(writtenKeys.length, assetCount);
        assert.equal(uploaded.length, assetCount);
        assert.equal(
          uploaded.reduce(
            (total, asset) => total + asset.storedObject.contentLength,
            0
          ),
          BINARY_ASSET_PORTABILITY_LIMITS.maxTotalBytes
        );
        return "committed";
      }
    );

    assert.equal(result, "committed");
    assert.equal(stageCalls, 1);
    assert.equal(commitCalls, 1);
    assert.equal(maximumConcurrentWrites, 1);
    assert.equal(writtenKeys.length, assetCount);
    assert.equal(assertionCalls, assetCount * 2 + 1);
  });
});

function validatedAsset(
  index: number,
  bytes: Uint8Array,
  checksumSha256: string,
  fileSha256: string
): ValidatedPortableBinaryAsset {
  const suffix = String(index + 1).padStart(3, "0");
  return {
    binding: {
      kind: "project_document_source",
      sourceDocumentId: `source-document-${suffix}`,
    },
    bytes,
    checksumSha256,
    file: {
      path: `assets/${suffix}-scale.txt`,
      sha256: fileSha256,
      sizeBytes: bytes.byteLength,
    },
    mimeType: "text/plain",
    originalName: `scale-${suffix}.txt`,
    purpose: "PROJECT_DOCUMENT_SOURCE",
    sizeBytes: bytes.byteLength,
    sourceAssetId: `source-asset-${suffix}`,
    sourceProjectId: "source-project-scale",
  };
}
