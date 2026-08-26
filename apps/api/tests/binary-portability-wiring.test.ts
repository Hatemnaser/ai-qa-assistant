import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { unzipSync } from "fflate";

import { createAccountExportPackage } from "../src/modules/data-portability/account-export-package.ts";
import { createAccountDataPortabilityService } from "../src/modules/data-portability/account-data-portability.service.ts";
import { createAccountImportService } from "../src/modules/data-portability/account-import.service.ts";
import type { AccountImportRepository } from "../src/modules/data-portability/account-import.types.ts";
import type { BinaryAssetRestoreService } from "../src/modules/data-portability/binary-asset-restore.types.ts";
import type {
  CollectedPortableBinaryAssets,
  PortableBinaryAssetSource,
  ValidatedPortableBinaryAsset,
} from "../src/modules/data-portability/binary-assets.ts";
import { createDataPortabilityService } from "../src/modules/data-portability/data-portability.service.ts";
import type { DataPortabilityRepository } from "../src/modules/data-portability/data-portability.types.ts";
import { createProjectExportPackage } from "../src/modules/data-portability/export-package.ts";
import { previewProjectImportPackage } from "../src/modules/data-portability/import-package.ts";
import {
  ACCOUNT_EXPORT_BINARY_BYTES,
  ACCOUNT_EXPORT_TEST_DATE,
  createAccountBinaryAssets,
  createAccountExportSource,
} from "./helpers/accountExportPackage.ts";
import {
  PROJECT_EXPORT_TEST_DATE,
  createProjectExportSource,
} from "./helpers/projectExportPackage.ts";

const PROJECT_BYTES = createMinimalPng();

describe("binary portability composition", () => {
  it("collects owner-scoped project assets from storage before emitting v2", async () => {
    const source = createProjectExportSource();
    source.binaryAssets = [projectAssetSource()];
    const reads: string[] = [];
    const service = createDataPortabilityService({
      indexer: noopIndexer(),
      projectAccess: { async assertProjectAccess() {} },
      repository: projectRepository(source),
      storage: {
        async readObject(objectKey, maximumBytes) {
          reads.push(`${objectKey}:${maximumBytes}`);
          return storedObject(PROJECT_BYTES, "image/png");
        },
      },
    });

    const result = await service.exportOwnedProject(
      "user-1",
      "project-1",
      { includeChats: true }
    );

    assert.equal(result.manifest.formatVersion, "2.0");
    assert.equal(result.manifest.counts.assets, 1);
    assert.deepEqual(
      unzipSync(result.archive)["assets/001-checkout.png"],
      PROJECT_BYTES
    );
    assert.deepEqual(reads, [
      "chat-attachments/2026/08/project-source:4194304",
    ]);
  });

  it("collects account assets and does not silently omit private bytes", async () => {
    const source = createAccountExportSource();
    source.binaryAssets = [accountAssetSource()];
    const service = createAccountDataPortabilityService({
      now: () => ACCOUNT_EXPORT_TEST_DATE,
      repository: { async findAccountExportData() { return source; } },
      storage: {
        async readObject() {
          return storedObject(
            ACCOUNT_EXPORT_BINARY_BYTES,
            "application/json"
          );
        },
      },
    });

    const result = await service.exportAccountData("user-1");

    assert.equal(result.manifest.formatVersion, "2.0");
    assert.equal(result.manifest.counts.binaryAssets, 1);
    assert.deepEqual(
      unzipSync(result.archive)["assets/001-requirements.json"],
      ACCOUNT_EXPORT_BINARY_BYTES
    );
  });

  it("routes validated project bytes through the restore boundary before repository commit", async () => {
    const source = createProjectExportSource();
    const archive = createProjectExportPackage(
      source,
      { includeChats: true },
      PROJECT_EXPORT_TEST_DATE,
      projectBundle()
    ).archive;
    const preview = previewProjectImportPackage(archive);
    let repositoryAssets = 0;
    const repository = projectRepository(null, {
      async createImportedProject(_userId, packageData, uploadedAssets = []) {
        repositoryAssets = uploadedAssets.length;
        assert.equal(packageData.project.binaryAssets.length, 1);
        return {
          projectId: "target-project-1",
          projectName: "Checkout QA (Imported)",
          documents: [],
          counts: { assets: uploadedAssets.length, chats: 1, documents: 0, messages: 2 },
        };
      },
    });
    const service = createDataPortabilityService({
      binaryAssetRestore: passthroughRestore(),
      indexer: noopIndexer(),
      projectAccess: { async assertProjectAccess() {} },
      repository,
    });

    const result = await service.commitProjectImport(
      "user-1",
      archive,
      preview.packageDigest
    );

    assert.equal(repositoryAssets, 1);
    assert.equal(result.imported.assets, 1);
  });

  it("routes validated account bytes through the restore boundary before repository commit", async () => {
    const archive = createAccountExportPackage(
      createAccountExportSource(),
      ACCOUNT_EXPORT_TEST_DATE,
      createAccountBinaryAssets()
    ).archive;
    let repositoryAssets = 0;
    const accountRepository: AccountImportRepository = {
      async createImportedAccount(_userId, packageData, uploadedAssets = []) {
        repositoryAssets = uploadedAssets.length;
        assert.equal(packageData.binaryAssets.length, 1);
        return {
          counts: {
            accountMemories: 0,
            binaryAssets: uploadedAssets.length,
            chats: 1,
            documents: 0,
            messages: 2,
            projects: 1,
          },
          documents: [],
          skippedAccountMemories: 0,
        };
      },
      async findDocumentIndexStatuses() { return []; },
    };
    const service = createAccountImportService({
      accountRepository,
      binaryAssetRestore: passthroughRestore(),
      externalRepository: {
        async createImportedChats() { return { chats: 0, messages: 0 }; },
      },
      indexer: noopIndexer(),
    });
    const preview = await service.preview(archive);

    const result = await service.commit(
      "user-1",
      archive,
      preview.packageDigest
    );

    assert.equal(repositoryAssets, 1);
    assert.equal(result.imported.binaryAssets, 1);
  });
});

function passthroughRestore(): BinaryAssetRestoreService {
  return {
    async runWithPreparedAssets(_ownerId, assets, commit) {
      return commit(
        assets.map((asset, index) => {
          const { bytes: _bytes, ...descriptor } = asset;
          return {
            assetId: `target-asset-${index + 1}`,
            descriptor,
            fence: {
              attempt: 1,
              attemptToken: "test-attempt-token",
              sessionId: "test-restore-session",
            },
            objectKey: `restored/object-${index + 1}`,
            storedObject: {
              checksumSha256: descriptor.checksumSha256,
              contentLength: descriptor.sizeBytes,
              contentType: descriptor.mimeType,
              etag: `etag-${index + 1}`,
            },
          };
        })
      );
    },
  };
}

function projectRepository(
  source: ReturnType<typeof createProjectExportSource> | null,
  overrides: Partial<DataPortabilityRepository> = {}
): DataPortabilityRepository {
  return {
    async createImportedProject() { throw new Error("unused"); },
    async findOwnedProjectExportData() { return source; },
    async findProjectDocumentIndexStatuses() { return []; },
    ...overrides,
  };
}

function projectBundle(): CollectedPortableBinaryAssets {
  return bundleFromSource(projectAssetSource(), PROJECT_BYTES);
}

function bundleFromSource(
  source: PortableBinaryAssetSource,
  bytes: Uint8Array
): CollectedPortableBinaryAssets {
  const path = source.originalName === "checkout.png"
    ? "assets/001-checkout.png"
    : "assets/001-requirements.json";
  return {
    assets: [
      {
        binding: source.binding,
        checksumSha256: source.checksumSha256,
        file: {
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        },
        mimeType: source.detectedMimeType!,
        originalName: source.originalName,
        purpose: source.purpose,
        sizeBytes: bytes.byteLength,
        sourceAssetId: source.id,
        sourceProjectId: source.projectId,
      },
    ],
    entries: new Map([[path, bytes]]),
    totalBytes: bytes.byteLength,
  };
}

function projectAssetSource(): PortableBinaryAssetSource {
  return readyAsset({
    binding: { kind: "message_attachment", ordinal: 0, sourceMessageId: "message-1" },
    bytes: PROJECT_BYTES,
    declaredMimeType: "image/png",
    id: "asset-1",
    objectKey: "chat-attachments/2026/08/project-source",
    originalName: "checkout.png",
    projectId: "project-1",
  });
}

function accountAssetSource(): PortableBinaryAssetSource {
  return readyAsset({
    binding: { kind: "message_attachment", ordinal: 0, sourceMessageId: "message-1" },
    bytes: ACCOUNT_EXPORT_BINARY_BYTES,
    declaredMimeType: "application/json",
    id: "asset-1",
    objectKey: "chat-attachments/2026/08/account-source",
    originalName: "requirements.json",
    projectId: "project-1",
  });
}

function readyAsset(input: {
  binding: PortableBinaryAssetSource["binding"];
  bytes: Uint8Array;
  declaredMimeType: string;
  id: string;
  objectKey: string;
  originalName: string;
  projectId: string | null;
}): PortableBinaryAssetSource {
  const checksumSha256 = createHash("sha256")
    .update(input.bytes)
    .digest("base64");
  return {
    binding: input.binding,
    checksumSha256,
    createdAt: new Date("2026-08-23T12:00:00.000Z"),
    declaredMimeType: input.declaredMimeType,
    detectedMimeType: input.declaredMimeType,
    etag: "source-etag",
    expectedSizeBytes: input.bytes.byteLength,
    id: input.id,
    objectKey: input.objectKey,
    originalName: input.originalName,
    ownerId: "user-1",
    projectId: input.projectId,
    purpose: "CHAT_ATTACHMENT",
    readyAt: new Date("2026-08-23T12:01:00.000Z"),
    sizeBytes: input.bytes.byteLength,
    status: "READY",
    updatedAt: new Date("2026-08-23T12:01:00.000Z"),
    uploadExpiresAt: null,
    validationStartedAt: null,
  };
}

function storedObject(bytes: Uint8Array, mimeType: string) {
  return {
    bytes,
    metadata: {
      checksumSha256: createHash("sha256").update(bytes).digest("base64"),
      contentLength: bytes.byteLength,
      contentType: mimeType,
      etag: "source-etag",
    },
  };
}

function noopIndexer() {
  return {
    async ensureDocumentsIndexed() {},
    async indexDocument() {},
    async indexDocuments() {},
  };
}

function createMinimalPng() {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 1, false);
  new DataView(bytes.buffer).setUint32(20, 1, false);
  return bytes;
}
