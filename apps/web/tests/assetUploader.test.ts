import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uploadPrivateAsset, sha256Base64 } from "../src/features/assets/assetUploader.ts";
import type { AssetDto, InitiateAssetResponse } from "../src/features/assets/types.ts";

describe("private asset uploader", () => {
  it("computes the Web Crypto SHA-256 checksum in the API's base64 format", async () => {
    const checksum = await sha256Base64(new Blob(["hello"]));

    assert.equal(checksum, "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
  });

  it("initiates, uploads, and completes with the same checksum and declared metadata", async () => {
    const calls: string[] = [];
    const file = new File(["# Rules"], "rules.md", { type: "" });
    const result = await uploadPrivateAsset(
      file,
      {
        declaredMimeType: "text/markdown",
        projectId: "project-1",
        purpose: "PROJECT_DOCUMENT_SOURCE",
      },
      {
        async cancel() {
          calls.push("cancel");
        },
        async complete(assetId, checksum) {
          calls.push(`complete:${assetId}:${checksum}`);
          return createAsset({ id: assetId, status: "READY" });
        },
        async digest() {
          calls.push("digest");
          return CHECKSUM;
        },
        async initiate(input) {
          calls.push(`initiate:${JSON.stringify(input)}`);
          return createInitiatedAsset();
        },
        async put(upload, uploadedFile) {
          calls.push(`put:${upload.method}:${uploadedFile.name}`);
        },
      }
    );

    assert.equal(result.asset.id, "asset-1");
    assert.deepEqual(calls, [
      "digest",
      `initiate:${JSON.stringify({
        checksumSha256: CHECKSUM,
        declaredMimeType: "text/markdown",
        expectedSizeBytes: file.size,
        originalName: "rules.md",
        projectId: "project-1",
        purpose: "PROJECT_DOCUMENT_SOURCE",
      })}`,
      "put:PUT:rules.md",
      `complete:asset-1:${CHECKSUM}`,
    ]);
  });

  it("best-effort cancels an initiated asset without hiding the original upload failure", async () => {
    const originalError = new Error("R2 upload failed");
    const cancelled: string[] = [];

    await assert.rejects(
      () => uploadPrivateAsset(
        new File(["hello"], "notes.txt", { type: "text/plain" }),
        { purpose: "CHAT_ATTACHMENT" },
        {
          async cancel(assetId) {
            cancelled.push(assetId);
            throw new Error("cleanup unavailable");
          },
          async complete() {
            throw new Error("complete should not run");
          },
          async digest() {
            return CHECKSUM;
          },
          async initiate() {
            return createInitiatedAsset();
          },
          async put() {
            throw originalError;
          },
        }
      ),
      (error: unknown) => error === originalError
    );
    assert.deepEqual(cancelled, ["asset-1"]);
  });
});

const CHECKSUM = "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=";

function createInitiatedAsset(): InitiateAssetResponse {
  return {
    asset: createAsset(),
    upload: {
      expiresAt: "2026-08-12T12:10:00.000Z",
      headers: {
        "content-length": "7",
        "content-type": "text/markdown",
        "if-none-match": "*",
        "x-amz-checksum-sha256": CHECKSUM,
      },
      method: "PUT",
      url: "https://upload.invalid/signed",
    },
  };
}

function createAsset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    createdAt: "2026-08-12T12:00:00.000Z",
    declaredMimeType: "text/markdown",
    detectedMimeType: null,
    expectedSizeBytes: 7,
    id: "asset-1",
    originalName: "rules.md",
    projectId: "project-1",
    purpose: "PROJECT_DOCUMENT_SOURCE",
    readyAt: null,
    sizeBytes: null,
    status: "PENDING",
    ...overrides,
  };
}
