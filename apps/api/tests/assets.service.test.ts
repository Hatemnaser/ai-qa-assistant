import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createAssetsService } from "../src/modules/assets/assets.service.ts";
import type { AssetStorage } from "../src/modules/assets/assets.storage.ts";
import type { AssetRecord, AssetsRepository } from "../src/modules/assets/assets.types.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const CHECKSUM = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
const OTHER_CHECKSUM = "YmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmI=";

describe("assets service", () => {
  let state: ReturnType<typeof createHarness>;

  beforeEach(() => {
    state = createHarness();
  });

  it("is fail-closed while private storage is disabled", async () => {
    state.config.privateAssetsEnabled = false;

    await assert.rejects(
      () => state.service.initiateUpload("user-1", createInitiateInput()),
      (error: unknown) => hasCode(error, "ASSET_STORAGE_DISABLED")
    );
  });

  it("creates an opaque server key and signs upload invariants", async () => {
    const response = await state.service.initiateUpload("user-1", createInitiateInput());

    assert.equal(response.asset.id, "asset-1");
    assert.equal(response.upload.method, "PUT");
    assert.equal(response.upload.headers["content-length"], "68");
    assert.equal(response.upload.headers["content-type"], "image/png");
    assert.equal(response.upload.headers["x-amz-checksum-sha256"], CHECKSUM);
    assert.equal(response.upload.headers["if-none-match"], "*");
    assert.deepEqual(state.projectChecks, [{ projectId: "project-1", userId: "user-1" }]);
    assert.equal(state.assets[0]?.objectKey, "chat-attachments/2026/08/12/server-generated-key");
    assert.equal(state.uploadRequests[0]?.objectKey, "chat-attachments/2026/08/12/server-generated-key");
  });

  it("never embeds the user identity in a default object key", async () => {
    state = createHarness({ useDefaultObjectKey: true });

    await state.service.initiateUpload("sensitive-user-id", createInitiateInput());

    assert.match(
      state.assets[0]?.objectKey || "",
      /^chat-attachments\/2026\/08\/12\/[a-f0-9]{48}$/
    );
    assert.doesNotMatch(state.assets[0]?.objectKey || "", /sensitive-user-id/);
  });

  it("enforces pending concurrency and user quota before creating records", async () => {
    state.pendingCount = state.config.assetMaxPendingPerUser;
    await assert.rejects(
      () => state.service.initiateUpload("user-1", createInitiateInput()),
      (error: unknown) => hasCode(error, "ASSET_PENDING_LIMIT_REACHED")
    );

    state.pendingCount = 0;
    state.reservedBytes = state.config.assetUserQuotaBytes;
    await assert.rejects(
      () => state.service.initiateUpload("user-1", createInitiateInput()),
      (error: unknown) => hasCode(error, "ASSET_QUOTA_REACHED")
    );
  });

  it("does not over-reserve when initiations race", async () => {
    state.config.assetMaxPendingPerUser = 1;
    const results = await Promise.allSettled([
      state.service.initiateUpload("user-1", createInitiateInput()),
      state.service.initiateUpload("user-1", createInitiateInput()),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(state.assets.length, 1);
  });

  it("completes only matching checksummed metadata and valid magic bytes", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());

    const asset = await state.service.completeUpload("user-1", "asset-1", {
      checksumSha256: CHECKSUM,
    });

    assert.equal(asset.status, "READY");
    assert.equal(asset.detectedMimeType, "image/png");
    assert.equal(asset.sizeBytes, 68);
    assert.deepEqual(state.readMaximums, [68]);
  });

  it("reads and validates the complete text object before making it ready", async () => {
    const input = {
      checksumSha256: CHECKSUM,
      declaredMimeType: "text/plain",
      expectedSizeBytes: 5,
      originalName: "notes.txt",
      projectId: "project-1",
      purpose: "PROJECT_DOCUMENT_SOURCE" as const,
    };
    state.objectMetadata.contentLength = 5;
    state.objectMetadata.contentType = "text/plain";
    state.sampleBytes = new TextEncoder().encode("hello");
    await state.service.initiateUpload("user-1", input);

    const asset = await state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM });

    assert.equal(asset.status, "READY");
    assert.deepEqual(state.readMaximums, [5]);
  });

  it("atomically claims validation so concurrent completes do not validate twice", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());

    const results = await Promise.allSettled([
      state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM }),
      state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(state.inspectCalls, 1);
  });

  it("fails and queues deletion when uploaded metadata is different", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());
    state.objectMetadata.contentLength = 67;

    await assert.rejects(
      () => state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM }),
      (error: unknown) => hasCode(error, "ASSET_VALIDATION_FAILED")
    );
    assert.equal(state.assets[0]?.status, "DELETE_PENDING");
    assert.deepEqual(state.queuedObjectKeys, ["chat-attachments/2026/08/12/server-generated-key"]);
  });

  it("uses the initiated checksum as the completion source of truth", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());

    await assert.rejects(
      () => state.service.completeUpload("user-1", "asset-1", { checksumSha256: OTHER_CHECKSUM }),
      (error: unknown) => hasCode(error, "ASSET_VALIDATION_FAILED")
    );
    assert.equal(state.inspectCalls, 0);
    assert.equal(state.assets[0]?.status, "DELETE_PENDING");
  });

  it("releases a validation claim after a transient object lookup failure", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());
    state.inspectError = new Error("temporary provider failure");

    await assert.rejects(
      () => state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM }),
      (error: unknown) => hasCode(error, "ASSET_VALIDATION_UNAVAILABLE")
    );
    assert.equal(state.assets[0]?.status, "PENDING");

    state.inspectError = null;
    assert.equal(
      (await state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM })).status,
      "READY"
    );
  });

  it("authorizes downloads by opaque asset ID and never returns an object key", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());
    await state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM });

    const response = await state.service.getDownloadUrl("user-1", "asset-1");
    assert.equal(response.download.url, "https://signed.invalid/download?secret=query");
    assert.doesNotMatch(JSON.stringify(response), /objectKey|server-generated-key/);

    await assert.rejects(
      () => state.service.getDownloadUrl("other-user", "asset-1"),
      (error: unknown) => hasCode(error, "ASSET_NOT_FOUND")
    );
  });

  it("allows clients to discard an unlinked READY asset after downstream failure", async () => {
    await state.service.initiateUpload("user-1", createInitiateInput());
    await state.service.completeUpload("user-1", "asset-1", { checksumSha256: CHECKSUM });

    await state.service.cancelUpload("user-1", "asset-1");

    assert.equal(state.assets[0]?.status, "DELETE_PENDING");
    assert.deepEqual(state.queuedObjectKeys, ["chat-attachments/2026/08/12/server-generated-key"]);
  });
});

function createHarness(options: { useDefaultObjectKey?: boolean } = {}) {
  const config = {
    assetDownloadUrlTtlSeconds: 300,
    assetMaxImageBytes: 4_194_304,
    assetMaxPendingPerUser: 4,
    assetMaxTextBytes: 1_048_576,
    assetUploadUrlTtlSeconds: 600,
    assetUserQuotaBytes: 52_428_800,
    privateAssetsEnabled: true,
  };
  const assets: AssetRecord[] = [];
  const queuedObjectKeys: string[] = [];
  const projectChecks: Array<{ projectId: string; userId: string }> = [];
  const uploadRequests: Array<{ objectKey: string }> = [];
  const readMaximums: number[] = [];
  let pendingCount = 0;
  let reservedBytes = 0;
  let inspectCalls = 0;
  let inspectError: Error | null = null;
  let sampleBytes: Uint8Array = createPngBytes(16, 16, 68);
  const objectMetadata = {
    checksumSha256: CHECKSUM,
    contentLength: 68,
    contentType: "image/png",
    etag: "etag-1",
  };
  const repository: AssetsRepository = {
    async cancelPendingAsset(ownerId, assetId) {
      const asset = assets.find((item) => item.ownerId === ownerId && item.id === assetId && item.status === "PENDING");
      if (!asset) return null;
      asset.status = "DELETE_PENDING";
      queuedObjectKeys.push(asset.objectKey);
      return asset.objectKey;
    },
    async claimPendingAssetForValidation(ownerId, assetId) {
      const asset = assets.find((item) => item.id === assetId && item.ownerId === ownerId && item.status === "PENDING");
      if (!asset) return null;
      asset.status = "VALIDATING";
      asset.validationStartedAt = NOW;
      return asset;
    },
    async completeValidatingAsset(input) {
      const asset = assets.find((item) => item.id === input.assetId && item.ownerId === input.ownerId);
      if (!asset || asset.status !== "VALIDATING") return null;
      Object.assign(asset, {
        detectedMimeType: input.detectedMimeType,
        etag: input.etag,
        readyAt: input.readyAt,
        sizeBytes: input.sizeBytes,
        status: "READY",
        validationStartedAt: null,
      });
      return asset;
    },
    async createPendingAssetReservation(input) {
      if (pendingCount >= input.maxPendingPerUser) {
        throw Object.assign(new Error("Too many uploads are pending."), { code: "ASSET_PENDING_LIMIT_REACHED" });
      }
      if (reservedBytes + input.expectedSizeBytes > input.userQuotaBytes) {
        throw Object.assign(new Error("Storage quota reached."), { code: "ASSET_QUOTA_REACHED" });
      }
      const asset = createAsset({ ...input, id: `asset-${assets.length + 1}` });
      assets.push(asset);
      pendingCount += 1;
      reservedBytes += input.expectedSizeBytes;
      return asset;
    },
    async enqueueAssetDeletion(ownerId, assetId) {
      const asset = assets.find(
        (item) => item.ownerId === ownerId && item.id === assetId && item.status === "READY"
      );
      if (!asset) return null;
      asset.status = "DELETE_PENDING";
      queuedObjectKeys.push(asset.objectKey);
      return asset.objectKey;
    },
    async failValidatingAsset(ownerId, assetId) {
      const asset = assets.find((item) => item.ownerId === ownerId && item.id === assetId && item.status === "VALIDATING");
      if (!asset) return null;
      asset.status = "DELETE_PENDING";
      queuedObjectKeys.push(asset.objectKey);
      return asset.objectKey;
    },
    async claimCleanupBatch() {
      return {
        cleanupCandidatesMayRemain: false,
        cleanupQueued: 0,
        deletionBacklog: 0,
        dueDeletionBacklog: 0,
        jobs: [],
        lockAcquired: true,
      };
    },
    async findOwnedAsset(ownerId, assetId) { return assets.find((item) => item.ownerId === ownerId && item.id === assetId) || null; },
    async markAssetFailed(ownerId, assetId) {
      const asset = assets.find((item) => item.ownerId === ownerId && item.id === assetId);
      if (asset) asset.status = "FAILED";
    },
    async recordDeletionFailure() { return true; },
    async releaseValidationClaim(ownerId, assetId) {
      const asset = assets.find((item) => item.ownerId === ownerId && item.id === assetId && item.status === "VALIDATING");
      if (asset) asset.status = "PENDING";
    },
    async removeDeletedObject() { return true; },
    async renewDeletionClaim() { return true; },
  };
  const storage: AssetStorage = {
    async createDownloadUrl() { return "https://signed.invalid/download?secret=query"; },
    async createUploadUrl(input) {
      uploadRequests.push(input);
      return {
        headers: {
          "content-length": String(input.contentLength),
          "content-type": input.contentType,
          "if-none-match": "*",
          "x-amz-checksum-sha256": input.checksumSha256,
        },
        url: "https://signed.invalid/upload?secret=query",
      };
    },
    async deleteObject() {},
    async inspectObject() {
      inspectCalls += 1;
      if (inspectError) throw inspectError;
      return objectMetadata;
    },
    async readObject() { throw new Error("not used"); },
    async readObjectSample(_objectKey, maximumBytes) {
      readMaximums.push(maximumBytes);
      return {
        bytes: sampleBytes,
        metadata: objectMetadata,
      };
    },
    async writeObject() { throw new Error("not used"); },
  };
  const service = createAssetsService({
    config,
    ...(options.useDefaultObjectKey ? {} : {
      createObjectKey: (purpose: AssetRecord["purpose"], createdAt: Date) => {
        const prefix = purpose === "CHAT_ATTACHMENT" ? "chat-attachments" : "project-documents";
        return `${prefix}/${createdAt.toISOString().slice(0, 10).replaceAll("-", "/")}/server-generated-key`;
      },
    }),
    now: () => NOW,
    projectAccess: {
      async assertProjectAccess(userId, projectId) { projectChecks.push({ projectId, userId }); },
    },
    repository,
    storage,
  });

  return {
    assets,
    config,
    objectMetadata,
    projectChecks,
    queuedObjectKeys,
    readMaximums,
    service,
    uploadRequests,
    get sampleBytes() { return sampleBytes; },
    set sampleBytes(value: Uint8Array) { sampleBytes = value; },
    get inspectCalls() { return inspectCalls; },
    get inspectError() { return inspectError; },
    set inspectError(value: Error | null) { inspectError = value; },
    get pendingCount() { return pendingCount; },
    set pendingCount(value: number) { pendingCount = value; },
    get reservedBytes() { return reservedBytes; },
    set reservedBytes(value: number) { reservedBytes = value; },
  };
}

function createAsset(input: Record<string, unknown>): AssetRecord {
  return {
    createdAt: NOW,
    checksumSha256: String(input.checksumSha256),
    declaredMimeType: String(input.declaredMimeType),
    detectedMimeType: null,
    etag: null,
    expectedSizeBytes: Number(input.expectedSizeBytes),
    id: String(input.id),
    objectKey: String(input.objectKey),
    originalName: String(input.originalName),
    ownerId: String(input.ownerId),
    projectId: input.projectId ? String(input.projectId) : null,
    purpose: input.purpose as AssetRecord["purpose"],
    readyAt: null,
    sizeBytes: null,
    status: "PENDING",
    updatedAt: NOW,
    uploadExpiresAt: input.uploadExpiresAt as Date,
    validationStartedAt: null,
  };
}

function createInitiateInput() {
  return {
    checksumSha256: CHECKSUM,
    declaredMimeType: "image/png",
    expectedSizeBytes: 68,
    originalName: "screen.png",
    projectId: "project-1",
    purpose: "CHAT_ATTACHMENT" as const,
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function createPngHeader(width: number, height: number) {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function createPngBytes(width: number, height: number, size: number) {
  const bytes = new Uint8Array(size);
  bytes.set(createPngHeader(width, height));
  return bytes;
}
