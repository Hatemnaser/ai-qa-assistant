import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createR2AssetStorage, isAssetStorageConfigured } from "../src/modules/assets/assets.storage.ts";

const CHECKSUM = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";

describe("R2 asset storage adapter", () => {
  it("keeps cleanup capability independent from the new-upload feature flag", () => {
    assert.equal(isAssetStorageConfigured({
      r2AccessKeyId: "key",
      r2BucketName: "bucket",
      r2Endpoint: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
      r2SecretAccessKey: "secret",
    }), true);
    assert.equal(isAssetStorageConfigured({
      r2AccessKeyId: "",
      r2BucketName: "",
      r2Endpoint: "",
      r2SecretAccessKey: "",
    }), false);
  });

  it("signs immutable upload metadata without exposing the secret or a public object URL", async () => {
    const endpoint = `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`;
    const storage = createR2AssetStorage({
      r2AccessKeyId: "test-access-key",
      r2BucketName: "oddpath-private-assets",
      r2Endpoint: endpoint,
      r2Region: "auto",
      r2SecretAccessKey: "do-not-leak-this-secret",
    });

    const signed = await storage.createUploadUrl({
      checksumSha256: CHECKSUM,
      contentLength: 128,
      contentType: "text/plain",
      expiresInSeconds: 300,
      objectKey: "project-documents/2026/08/12/random",
    });
    const url = new URL(signed.url);
    const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders") || "";

    assert.equal(url.origin, endpoint);
    assert.match(url.pathname, /oddpath-private-assets\/project-documents\/2026\/08\/12\/random$/);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.match(signedHeaders, /content-length/);
    assert.match(signedHeaders, /content-type/);
    assert.match(signedHeaders, /if-none-match/);
    assert.match(signedHeaders, /x-amz-checksum-sha256/);
    assert.deepEqual(signed.headers, {
      "content-length": "128",
      "content-type": "text/plain",
      "if-none-match": "*",
      "x-amz-checksum-sha256": CHECKSUM,
    });
    assert.doesNotMatch(signed.url, /do-not-leak-this-secret/);
  });

  it("rejects invalid bounded reads and server-side writes before contacting storage", async () => {
    const storage = createR2AssetStorage({
      r2AccessKeyId: "test-access-key",
      r2BucketName: "oddpath-private-assets",
      r2Endpoint: `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
      r2Region: "auto",
      r2SecretAccessKey: "secret",
    });

    await assert.rejects(
      () => storage.readObject("asset-key", 0),
      /positive safe integer/
    );
    await assert.rejects(
      () => storage.writeObject({
        bytes: new TextEncoder().encode("different bytes"),
        checksumSha256: CHECKSUM,
        contentType: "text/plain",
        maximumBytes: 1024,
        objectKey: "asset-key",
      }),
      /checksum does not match/
    );
    await assert.rejects(
      () => storage.writeObject({
        bytes: new TextEncoder().encode("too large"),
        checksumSha256: "Jm2K4y2cZ6gDAgxG6m5uF8pC6BrfGjYTTuBXL8i5fTw=",
        contentType: "text/plain",
        maximumBytes: 1,
        objectKey: "asset-key",
      }),
      /input is invalid/
    );
  });
});
