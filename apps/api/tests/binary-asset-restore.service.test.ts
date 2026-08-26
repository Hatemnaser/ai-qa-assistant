import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import { createBinaryAssetRestoreService } from "../src/modules/data-portability/binary-asset-restore.service.ts";
import type {
  BinaryAssetRestoreRepository,
  BinaryAssetRestoreReservation,
} from "../src/modules/data-portability/binary-asset-restore.types.ts";
import type { ValidatedPortableBinaryAsset } from "../src/modules/data-portability/binary-assets.ts";

const NOW = new Date("2026-08-23T12:00:00.000Z");
const BYTES = new TextEncoder().encode("portable restore bytes");
const CHECKSUM = createHash("sha256").update(BYTES).digest("base64");

describe("binary asset restore service", () => {
  it("keeps legacy imports storage-independent when there are no binary assets", async () => {
    let staged = false;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 1, privateAssetsEnabled: false },
      repository: fakeRepository({ stage: async () => { staged = true; } }),
      storage: disabledStorage(),
    });

    const result = await service.runWithPreparedAssets("user-1", [], async (assets) => {
      assert.deepEqual(assets, []);
      return "committed";
    });

    assert.equal(result, "committed");
    assert.equal(staged, false);
  });

  it("durably stages before immutable writes and passes verified uploads to commit", async () => {
    const calls: string[] = [];
    let stagedReservation: BinaryAssetRestoreReservation | undefined;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "restored-asset-1",
      createAttemptToken: () => "attempt-token-1",
      createObjectKey: () => "chat-attachments/2026/08/23/restore-1",
      createSessionId: () => "restore-session-1",
      now: () => NOW,
      repository: fakeRepository({
        async stage(_ownerId, reservations, startedAt, cleanupNotBefore, quota) {
          calls.push("stage");
          stagedReservation = reservations[0];
          assert.equal(startedAt.toISOString(), NOW.toISOString());
          assert.equal(cleanupNotBefore.toISOString(), "2026-08-23T12:30:00.000Z");
          assert.equal(quota, 50_000);
          assert.deepEqual(stagedReservation?.fence, {
            attempt: 1,
            attemptToken: "attempt-token-1",
            sessionId: "restore-session-1",
          });
        },
      }),
      storage: {
        async writeObject(input) {
          calls.push("write");
          assert.equal(stagedReservation?.objectKey, input.objectKey);
          assert.deepEqual(input.bytes, BYTES);
          return {
            checksumSha256: CHECKSUM,
            contentLength: BYTES.byteLength,
            contentType: "text/plain",
            etag: "etag-1",
          };
        },
      },
    });

    const result = await service.runWithPreparedAssets(
      "user-1",
      [validatedAsset()],
      async (uploaded) => {
        calls.push("commit");
        assert.equal(uploaded[0]?.assetId, "restored-asset-1");
        assert.equal(uploaded[0]?.descriptor.sourceAssetId, "source-asset-1");
        assert.equal(uploaded[0]?.storedObject.etag, "etag-1");
        return 201;
      }
    );

    assert.equal(result, 201);
    assert.deepEqual(calls, ["stage", "write", "commit"]);
  });

  it("fences a stale attempt before it can start an object write", async () => {
    let writes = 0;
    let cleanupClaims = 0;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createAttemptToken: () => "stale-token",
      createObjectKey: () => "key-a",
      createSessionId: () => "session-a",
      now: () => NOW,
      repository: fakeRepository({
        async assertAttemptActive() { return false; },
        async markForCleanup() { cleanupClaims += 1; return ["key-a"]; },
      }),
      storage: {
        async writeObject() { writes += 1; return metadata(); },
      },
    });

    await assert.rejects(
      () => service.runWithPreparedAssets("user-1", [validatedAsset()], async () => null),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );
    assert.equal(writes, 0);
    assert.equal(cleanupClaims, 1);
  });

  it("fences a frozen worker when cleanup takes over during the provider write", async () => {
    let active = true;
    let commits = 0;
    let cleanupClaims = 0;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createAttemptToken: () => "attempt-token-1",
      createObjectKey: () => "key-a",
      createSessionId: () => "session-a",
      now: () => NOW,
      repository: fakeRepository({
        async assertAttemptActive() { return active; },
        async markForCleanup() { cleanupClaims += 1; return ["key-a"]; },
      }),
      storage: {
        async writeObject() {
          active = false;
          return metadata();
        },
      },
    });

    await assert.rejects(
      () => service.runWithPreparedAssets("user-1", [validatedAsset()], async () => {
        commits += 1;
        return null;
      }),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );
    assert.equal(commits, 0);
    assert.equal(cleanupClaims, 1);
  });

  it("quarantines cleanup instead of deleting inline when an object write is ambiguous", async () => {
    const calls: string[] = [];
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: sequence(["asset-a", "asset-b"]),
      createObjectKey: sequence(["key-a", "key-b"]),
      now: () => NOW,
      repository: fakeRepository({
        async markForCleanup(_ownerId, reservations, cleanupNotBefore) {
          calls.push("mark");
          assert.deepEqual(reservations.map((item) => item.objectKey), ["key-a", "key-b"]);
          assert.equal(
            cleanupNotBefore.toISOString(),
            "2026-08-23T12:05:00.000Z"
          );
          return ["key-a", "key-b"];
        },
      }),
      storage: {
        async writeObject(input) {
          calls.push(`write:${input.objectKey}`);
          if (input.objectKey === "key-b") throw new Error("provider detail");
          return metadata();
        },
      },
    });

    await assert.rejects(
      () =>
        service.runWithPreparedAssets(
          "user-1",
          [
            validatedAsset(),
            validatedAsset({
              binding: {
                kind: "message_attachment",
                ordinal: 1,
                sourceMessageId: "message-1",
              },
              file: { ...validatedAsset().file, path: "assets/002-copy.txt" },
              sourceAssetId: "source-asset-2",
            }),
          ],
          async () => "unused"
        ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );

    assert.deepEqual(calls, [
      "write:key-a",
      "write:key-b",
      "mark",
    ]);
  });

  it("cleans staged objects but preserves a domain error from the atomic commit", async () => {
    let cleaned = false;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createObjectKey: () => "key-a",
      now: () => NOW,
      repository: fakeRepository({
        async markForCleanup(_ownerId, reservations) {
          cleaned = true;
          return reservations.map((reservation) => reservation.objectKey);
        },
      }),
      storage: {
        async writeObject() { return metadata(); },
      },
    });

    await assert.rejects(
      () =>
        service.runWithPreparedAssets("user-1", [validatedAsset()], async () => {
          throw new AppError("destination full", 409, "DESTINATION_FULL");
        }),
      (error: unknown) => hasCode(error, "DESTINATION_FULL")
    );
    assert.equal(cleaned, true);
  });

  it("does not delete an object when the staging row can no longer be claimed", async () => {
    let cleanupClaims = 0;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createObjectKey: () => "key-a",
      now: () => NOW,
      repository: fakeRepository({
        // Models a lost commit acknowledgement: the row may already be READY
        // and linked, so cleanup must not infer failure from the thrown call.
        async markForCleanup() {
          cleanupClaims += 1;
          return [];
        },
      }),
      storage: {
        async writeObject() { return metadata(); },
      },
    });

    await assert.rejects(
      () => service.runWithPreparedAssets("user-1", [validatedAsset()], async () => {
        throw new Error("commit acknowledgement lost");
      }),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );
    assert.equal(cleanupClaims, 1);
  });

  it("does not start another object write after the staging lease expires", async () => {
    let current = NOW;
    let writes = 0;
    let cleanupNotBefore: Date | undefined;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createObjectKey: () => "key-a",
      now: () => current,
      repository: fakeRepository({
        async stage() {
          current = new Date("2026-08-23T12:30:00.000Z");
        },
        async markForCleanup(_ownerId, _reservations, value) {
          cleanupNotBefore = value;
          return ["key-a"];
        },
      }),
      storage: {
        async writeObject() {
          writes += 1;
          return metadata();
        },
      },
    });

    await assert.rejects(
      () => service.runWithPreparedAssets("user-1", [validatedAsset()], async () => null),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );

    assert.equal(writes, 0);
    assert.equal(cleanupNotBefore?.toISOString(), "2026-08-23T12:35:00.000Z");
  });

  it("does not commit when the lease expires during an in-flight object write", async () => {
    let current = NOW;
    let commits = 0;
    let cleanupClaims = 0;
    const service = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "asset-a",
      createAttemptToken: () => "attempt-token-1",
      createObjectKey: () => "key-a",
      createSessionId: () => "session-a",
      now: () => current,
      repository: fakeRepository({
        async markForCleanup() { cleanupClaims += 1; return ["key-a"]; },
      }),
      storage: {
        async writeObject() {
          current = new Date("2026-08-23T12:30:00.000Z");
          return metadata();
        },
      },
    });

    await assert.rejects(
      () => service.runWithPreparedAssets("user-1", [validatedAsset()], async () => {
        commits += 1;
        return null;
      }),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_FAILED")
    );
    assert.equal(commits, 0);
    assert.equal(cleanupClaims, 1);
  });

  it("fails closed before staging when storage is disabled or generated keys collide", async () => {
    let stages = 0;
    const repository = fakeRepository({ async stage() { stages += 1; } });
    const disabled = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: false },
      repository,
      storage: disabledStorage(),
    });
    await assert.rejects(
      () => disabled.runWithPreparedAssets("user-1", [validatedAsset()], async () => null),
      (error: unknown) => hasCode(error, "ASSET_STORAGE_DISABLED")
    );

    const colliding = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50_000, privateAssetsEnabled: true },
      createAssetId: () => "same-id",
      createObjectKey: () => "same-key",
      repository,
      storage: disabledStorage(),
    });
    await assert.rejects(
      () => colliding.runWithPreparedAssets("user-1", [
        validatedAsset(),
        validatedAsset({
          binding: { kind: "message_attachment", ordinal: 1, sourceMessageId: "message-1" },
          file: { ...validatedAsset().file, path: "assets/002-copy.txt" },
          sourceAssetId: "source-asset-2",
        }),
      ], async () => null),
      (error: unknown) => hasCode(error, "ASSET_PORTABILITY_PACKAGE_INVALID")
    );
    assert.equal(stages, 0);
  });
});

function fakeRepository(
  overrides: Partial<BinaryAssetRestoreRepository> = {}
): BinaryAssetRestoreRepository {
  return {
    async assertAttemptActive() { return true; },
    async markForCleanup(_ownerId, reservations) {
      return reservations.map((reservation) => reservation.objectKey);
    },
    async stage() {},
    ...overrides,
  };
}

function validatedAsset(
  overrides: Partial<ValidatedPortableBinaryAsset> = {}
): ValidatedPortableBinaryAsset {
  return {
    binding: { kind: "message_attachment", ordinal: 0, sourceMessageId: "message-1" },
    bytes: BYTES,
    checksumSha256: CHECKSUM,
    file: {
      path: "assets/001-note.txt",
      sha256: createHash("sha256").update(BYTES).digest("hex"),
      sizeBytes: BYTES.byteLength,
    },
    mimeType: "text/plain",
    originalName: "note.txt",
    purpose: "CHAT_ATTACHMENT",
    sizeBytes: BYTES.byteLength,
    sourceAssetId: "source-asset-1",
    sourceProjectId: null,
    ...overrides,
  };
}

function metadata() {
  return {
    checksumSha256: CHECKSUM,
    contentLength: BYTES.byteLength,
    contentType: "text/plain",
    etag: "etag-1",
  };
}

function disabledStorage() {
  return {
    async writeObject(): Promise<never> { throw new Error("disabled"); },
  };
}

function sequence<T>(values: T[]) {
  let index = 0;
  return () => values[index++]!;
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
