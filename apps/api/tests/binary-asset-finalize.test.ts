import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "../src/generated/prisma/client.ts";
import {
  assertUploadedAssetsMatchPackage,
  finalizeStagedBinaryAssets,
} from "../src/modules/data-portability/binary-asset-finalize.ts";
import type { UploadedPortableBinaryAsset } from "../src/modules/data-portability/binary-asset-restore.types.ts";

const READY_AT = new Date("2026-08-23T12:05:00.000Z");

describe("binary asset restore finalization", () => {
  it("requires the uploaded restore plan to match the validated package exactly", () => {
    const uploaded = uploadedAsset();
    const expected = {
      ...uploaded.descriptor,
      bytes: new Uint8Array(128),
    };

    assert.doesNotThrow(() => assertUploadedAssetsMatchPackage([expected], [uploaded]));
    assert.throws(
      () => assertUploadedAssetsMatchPackage(
        [{ ...expected, originalName: "different.txt" }],
        [uploaded]
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
    assert.throws(
      () => assertUploadedAssetsMatchPackage([expected], []),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
  });

  it("promotes and links a message asset before releasing its cleanup job", async () => {
    const calls: string[] = [];
    const promotionInputs: unknown[] = [];
    const sessionDeleteInputs: unknown[] = [];
    const uploaded = uploadedAsset();
    const tx = fakeTransaction({
      uploaded,
      calls,
      bindingKind: "message",
      promotionInputs,
      sessionDeleteInputs,
    });

    await finalizeStagedBinaryAssets(
      tx,
      "user-1",
      [uploaded],
      {
        documentsBySourceId: new Map(),
        messagesBySourceId: new Map([
          ["source-message-1", { messageId: "message-new-1", projectId: "project-new-1" }],
        ]),
      },
      READY_AT
    );

    assert.deepEqual(calls, [
      "lock-session",
      "lock-asset",
      "read-session",
      "read-stages",
      "read-jobs",
      "promote",
      "link-message",
      "release-job",
      "delete-session",
    ]);
    assert.deepEqual(
      (promotionInputs[0] as { data: { restoreAttempt: unknown; restoreSessionId: unknown } }).data,
      {
        detectedMimeType: "text/plain",
        etag: "etag-1",
        projectId: "project-new-1",
        readyAt: READY_AT,
        restoreAttempt: null,
        restoreSessionId: null,
        sizeBytes: 128,
        status: "READY",
        uploadExpiresAt: null,
        validationStartedAt: null,
      }
    );
    assert.deepEqual(sessionDeleteInputs, [{
      where: {
        attempt: 1,
        attemptToken: "attempt-token-1",
        id: "restore-session-1",
        leaseExpiresAt: { gt: READY_AT },
        ownerId: "user-1",
      },
    }]);
  });

  it("links a document source asset to the imported document in the same transaction", async () => {
    const calls: string[] = [];
    const uploaded = uploadedAsset({
      descriptor: {
        ...uploadedAsset().descriptor,
        binding: { kind: "project_document_source", sourceDocumentId: "source-document-1" },
        purpose: "PROJECT_DOCUMENT_SOURCE",
        sourceProjectId: "source-project-1",
      },
    });
    const tx = fakeTransaction({ uploaded, calls, bindingKind: "document" });

    await finalizeStagedBinaryAssets(
      tx,
      "user-1",
      [uploaded],
      {
        documentsBySourceId: new Map([
          ["source-document-1", { documentId: "document-new-1", projectId: "project-new-1" }],
        ]),
        messagesBySourceId: new Map(),
      },
      READY_AT
    );

    assert.deepEqual(calls, [
      "lock-session",
      "lock-asset",
      "read-session",
      "read-stages",
      "read-jobs",
      "promote",
      "link-document",
      "release-job",
      "delete-session",
    ]);
  });

  it("rejects a stale or expired restore attempt before promotion", async () => {
    const calls: string[] = [];
    const uploaded = uploadedAsset();

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        fakeTransaction({ uploaded, calls, omitSession: true }),
        "user-1",
        [uploaded],
        {
          documentsBySourceId: new Map(),
          messagesBySourceId: new Map([
            ["source-message-1", { messageId: "message-new-1", projectId: null }],
          ]),
        },
        READY_AT
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
    assert.equal(calls.includes("promote"), false);
    assert.equal(calls.includes("delete-session"), false);
  });

  it("rejects a staged original filename mismatch before promotion", async () => {
    const calls: string[] = [];
    const uploaded = uploadedAsset();

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        fakeTransaction({
          uploaded,
          calls,
          stagedOverride: { originalName: "different.txt" },
        }),
        "user-1",
        [uploaded],
        {
          documentsBySourceId: new Map(),
          messagesBySourceId: new Map([
            ["source-message-1", { messageId: "message-new-1", projectId: null }],
          ]),
        }
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
    assert.equal(calls.includes("promote"), false);
  });

  it("fails closed before promotion when the stage, object receipt, job, or target is missing", async () => {
    const uploaded = uploadedAsset();

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        fakeTransaction({ uploaded, stagedOverride: { checksumSha256: "wrong" } }),
        "user-1",
        [uploaded],
        {
          documentsBySourceId: new Map(),
          messagesBySourceId: new Map([
            ["source-message-1", { messageId: "message-new-1", projectId: null }],
          ]),
        }
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        fakeTransaction({ uploaded, omitJob: true }),
        "user-1",
        [uploaded],
        { documentsBySourceId: new Map(), messagesBySourceId: new Map() }
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        fakeTransaction({ uploaded }),
        "user-1",
        [uploaded],
        { documentsBySourceId: new Map(), messagesBySourceId: new Map() }
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
  });

  it("rejects duplicate restore identities and bindings before reading mutable state", async () => {
    let queried = false;
    const uploaded = uploadedAsset();
    const tx = {
      storedAsset: { async findMany() { queried = true; return []; } },
      objectDeletionJob: { async findMany() { queried = true; return []; } },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => finalizeStagedBinaryAssets(
        tx,
        "user-1",
        [uploaded, { ...uploaded, descriptor: { ...uploaded.descriptor, sourceAssetId: "other" } }],
        { documentsBySourceId: new Map(), messagesBySourceId: new Map() }
      ),
      (error: unknown) => hasCode(error, "ASSET_RESTORE_STATE_INVALID")
    );
    assert.equal(queried, false);
  });
});

function fakeTransaction({
  uploaded,
  calls = [],
  bindingKind = "message",
  omitJob = false,
  omitSession = false,
  promotionInputs = [],
  sessionDeleteInputs = [],
  stagedOverride = {},
}: {
  uploaded: UploadedPortableBinaryAsset;
  calls?: string[];
  bindingKind?: "document" | "message";
  omitJob?: boolean;
  omitSession?: boolean;
  promotionInputs?: unknown[];
  sessionDeleteInputs?: unknown[];
  stagedOverride?: Record<string, unknown>;
}) {
  return {
    async $executeRaw(_parts: TemplateStringsArray, lockId: string) {
      calls.push(lockId.startsWith("oddpath:asset-restore:") ? "lock-session" : "lock-asset");
      return 1;
    },
    binaryAssetRestoreSession: {
      async deleteMany(input: unknown) {
        calls.push("delete-session");
        sessionDeleteInputs.push(input);
        return { count: 1 };
      },
      async findFirst() {
        calls.push("read-session");
        return omitSession ? null : { id: uploaded.fence.sessionId };
      },
    },
    messageAttachment: {
      async create() { calls.push("link-message"); return {}; },
    },
    objectDeletionJob: {
      async deleteMany() { calls.push("release-job"); return { count: 1 }; },
      async findMany() {
        calls.push("read-jobs");
        return omitJob ? [] : [{ objectKey: uploaded.objectKey }];
      },
    },
    projectDocument: {
      async updateMany() {
        calls.push("link-document");
        return { count: bindingKind === "document" ? 1 : 0 };
      },
    },
    storedAsset: {
      async findMany() {
        calls.push("read-stages");
        return [{
          checksumSha256: uploaded.descriptor.checksumSha256,
          declaredMimeType: uploaded.descriptor.mimeType,
          expectedSizeBytes: uploaded.descriptor.sizeBytes,
          id: uploaded.assetId,
          objectKey: uploaded.objectKey,
          originalName: uploaded.descriptor.originalName,
          ownerId: "user-1",
          projectId: null,
          purpose: uploaded.descriptor.purpose,
          restoreAttempt: uploaded.fence.attempt,
          restoreSessionId: uploaded.fence.sessionId,
          status: "PENDING",
          ...stagedOverride,
        }];
      },
      async updateMany(input: unknown) {
        calls.push("promote");
        promotionInputs.push(input);
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;
}

function uploadedAsset(
  overrides: Partial<UploadedPortableBinaryAsset> = {}
): UploadedPortableBinaryAsset {
  const checksum = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";
  return {
    assetId: "asset-new-1",
    descriptor: {
      binding: { kind: "message_attachment", ordinal: 0, sourceMessageId: "source-message-1" },
      checksumSha256: checksum,
      file: { path: "assets/001-note.txt", sha256: "a".repeat(64), sizeBytes: 128 },
      mimeType: "text/plain",
      originalName: "note.txt",
      purpose: "CHAT_ATTACHMENT",
      sizeBytes: 128,
      sourceAssetId: "source-asset-1",
      sourceProjectId: "source-project-1",
    },
    objectKey: "chat-attachments/restore-1",
    fence: {
      attempt: 1,
      attemptToken: "attempt-token-1",
      sessionId: "restore-session-1",
    },
    storedObject: {
      checksumSha256: checksum,
      contentLength: 128,
      contentType: "text/plain",
      etag: "etag-1",
    },
    ...overrides,
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
