import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type {
  CollectedPortableBinaryAssets,
  PortableBinaryAssetDescriptor,
} from "../src/modules/data-portability/binary-assets.ts";
import { createProjectExportPackage } from "../src/modules/data-portability/export-package.ts";
import {
  previewProjectImportPackage,
  validateProjectImportPackage,
} from "../src/modules/data-portability/import-package.ts";
import {
  createProjectExportSource,
  createTestProjectExportArchive,
  PROJECT_EXPORT_TEST_DATE,
} from "./helpers/projectExportPackage.ts";

const CHAT_ASSET_BYTES = createMinimalPng(1, 1);
const DOCUMENT_ASSET_BYTES = strToU8('{"guestCheckout":false}\n');

describe("Project Portable ZIP v2 binary assets", () => {
  it("round-trips a bound chat attachment and exposes safe preview counts", () => {
    const bundle = createChatAssetBundle();
    const result = createProjectExportPackage(
      createProjectExportSource(),
      { includeChats: true },
      PROJECT_EXPORT_TEST_DATE,
      bundle
    );
    const entries = unzipSync(result.archive);
    const manifest = readJsonEntry(entries, "manifest.json");
    const project = readJsonEntry(entries, "data/project.json");
    const chat = readJsonEntry(entries, "data/chats/chat-001.json");

    assert.equal(result.manifest.formatVersion, "2.0");
    assert.equal(manifest.formatVersion, "2.0");
    assert.equal(project.formatVersion, "2.0");
    assert.equal(chat.formatVersion, "2.0");
    assert.deepEqual(manifest.include, {
      assets: true,
      chats: true,
      documents: true,
      readable: true,
    });
    assert.deepEqual(manifest.counts, {
      assetBytes: CHAT_ASSET_BYTES.byteLength,
      assets: 1,
      chats: 1,
      documents: 1,
      messages: 2,
    });
    assert.deepEqual(entries["assets/001-checkout.png"], CHAT_ASSET_BYTES);
    assert.ok(
      (manifest.files as Array<{ path?: string }>).some(
        (file) => file.path === "assets/001-checkout.png"
      )
    );
    assert.deepEqual(manifest.warnings, []);

    const validated = validateProjectImportPackage(result.archive);
    assert.equal(validated.formatVersion, "2.0");
    assert.equal(validated.project.binaryAssets.length, 1);
    assert.deepEqual(validated.project.binaryAssets[0]?.bytes, CHAT_ASSET_BYTES);
    assert.deepEqual(validated.project.binaryAssets[0]?.binding, {
      kind: "message_attachment",
      ordinal: 0,
      sourceMessageId: "message-1",
    });

    const preview = previewProjectImportPackage(result.archive);
    assert.equal(preview.formatVersion, "2.0");
    assert.deepEqual(preview.counts, {
      assetBytes: CHAT_ASSET_BYTES.byteLength,
      assets: 1,
      chats: 1,
      documents: 1,
      messages: 2,
    });
  });

  it("round-trips a project-document source asset", () => {
    const archive = createProjectExportPackage(
      createProjectExportSource(),
      { includeChats: false },
      PROJECT_EXPORT_TEST_DATE,
      createDocumentAssetBundle()
    ).archive;
    const validated = validateProjectImportPackage(archive);

    assert.equal(validated.project.binaryAssets.length, 1);
    assert.deepEqual(validated.project.binaryAssets[0]?.binding, {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    });
    assert.deepEqual(
      validated.project.binaryAssets[0]?.bytes,
      DOCUMENT_ASSET_BYTES
    );
  });

  it("keeps legacy v1 archives importable with an empty binary asset list", () => {
    const archive = createTestProjectExportArchive();
    const validated = validateProjectImportPackage(archive);
    const preview = previewProjectImportPackage(archive);

    assert.equal(validated.formatVersion, "1.0");
    assert.deepEqual(validated.project.binaryAssets, []);
    assert.equal(preview.formatVersion, "1.0");
    assert.equal("assets" in preview.counts, false);
    assert.equal("assetBytes" in preview.counts, false);
  });

  it("rejects tampered bytes even when the outer file manifest is refreshed", () => {
    const archive = rewriteV2Archive(createV2Archive(), (entries, manifest) => {
      entries["assets/001-checkout.png"] = createMinimalPng(2, 1);
      refreshManifestFile(manifest, entries, "assets/001-checkout.png");
    });

    assertInvalidPackage(() => validateProjectImportPackage(archive));
  });

  it("rejects missing and undeclared extra asset entries", () => {
    const missing = rewriteV2Archive(createV2Archive(), (entries) => {
      delete entries["assets/001-checkout.png"];
    });
    const extra = rewriteV2Archive(createV2Archive(), (entries) => {
      entries["assets/002-extra.txt"] = strToU8("undeclared private bytes");
    });

    assertInvalidPackage(() => validateProjectImportPackage(missing));
    assertInvalidPackage(() => validateProjectImportPackage(extra));
  });

  it("rejects binding, project, name, and MIME relation mismatches", () => {
    const mutations: Array<(asset: PortableBinaryAssetDescriptor) => void> = [
      (asset) => {
        if (asset.binding.kind === "message_attachment") {
          asset.binding.sourceMessageId = "missing-message";
        }
      },
      (asset) => {
        asset.sourceProjectId = "another-project";
      },
      (asset) => {
        asset.originalName = "other.png";
      },
      (asset) => {
        asset.mimeType = "image/jpeg";
        asset.originalName = "checkout.jpg";
      },
    ];

    for (const mutate of mutations) {
      const archive = rewriteV2Archive(createV2Archive(), (_entries, manifest) => {
        const asset = (manifest.assets as PortableBinaryAssetDescriptor[])[0];
        assert.ok(asset);
        mutate(asset);
      });
      assertInvalidPackage(() => validateProjectImportPackage(archive));
    }
  });

  it("rejects traversal paths and duplicate descriptors inside the v2 manifest", () => {
    const traversal = rewriteV2Archive(createV2Archive(), (entries, manifest) => {
      const oldPath = "assets/001-checkout.png";
      const unsafePath = "assets/../checkout.png";
      entries[unsafePath] = entries[oldPath]!;
      delete entries[oldPath];

      const asset = (manifest.assets as PortableBinaryAssetDescriptor[])[0];
      assert.ok(asset);
      asset.file.path = unsafePath;
      const file = (manifest.files as Array<{ path: string }>).find(
        (candidate) => candidate.path === oldPath
      );
      assert.ok(file);
      file.path = unsafePath;
    });
    const duplicate = rewriteV2Archive(createV2Archive(), (_entries, manifest) => {
      const asset = (manifest.assets as PortableBinaryAssetDescriptor[])[0];
      assert.ok(asset);
      (manifest.assets as PortableBinaryAssetDescriptor[]).push({
        ...structuredClone(asset),
        sourceAssetId: "asset-2",
      });
      (manifest.counts as { assets: number; assetBytes: number }).assets = 2;
      (manifest.counts as { assets: number; assetBytes: number }).assetBytes =
        CHAT_ASSET_BYTES.byteLength * 2;
    });

    assertInvalidPackage(() => validateProjectImportPackage(traversal));
    assertInvalidPackage(() => validateProjectImportPackage(duplicate));
  });

  it("rejects descriptor checksums, asset counts, and cross-version chat data", () => {
    const checksum = rewriteV2Archive(createV2Archive(), (_entries, manifest) => {
      const asset = (manifest.assets as PortableBinaryAssetDescriptor[])[0];
      assert.ok(asset);
      asset.file.sha256 = "0".repeat(64);
    });
    const count = rewriteV2Archive(createV2Archive(), (_entries, manifest) => {
      (manifest.counts as { assets: number }).assets = 2;
    });
    const mixedVersion = rewriteV2Archive(createV2Archive(), (entries, manifest) => {
      const chat = readJsonEntry(entries, "data/chats/chat-001.json");
      chat.formatVersion = "1.0";
      entries["data/chats/chat-001.json"] = encodeJson(chat);
      refreshManifestFile(manifest, entries, "data/chats/chat-001.json");
    });

    assertInvalidPackage(() => validateProjectImportPackage(checksum));
    assertInvalidPackage(() => validateProjectImportPackage(count));
    assertInvalidPackage(() => validateProjectImportPackage(mixedVersion));
  });

  it("rejects asset entries smuggled into a legacy v1 archive", () => {
    const entries = unzipSync(createTestProjectExportArchive());
    entries["assets/001-smuggled.txt"] = strToU8("private bytes");

    assertInvalidPackage(() =>
      validateProjectImportPackage(Buffer.from(zipSync(entries)))
    );
  });

  it("fails export closed when the supplied bundle does not match project relations", () => {
    const bundle = createChatAssetBundle();
    const descriptor = bundle.assets[0];
    assert.ok(descriptor && descriptor.binding.kind === "message_attachment");
    descriptor.binding.sourceMessageId = "foreign-message";

    assert.throws(
      () =>
        createProjectExportPackage(
          createProjectExportSource(),
          { includeChats: true },
          PROJECT_EXPORT_TEST_DATE,
          bundle
        ),
      (error: unknown) => hasCode(error, "PROJECT_EXPORT_ASSET_DATA_INVALID")
    );
  });
});

function createV2Archive() {
  return createProjectExportPackage(
    createProjectExportSource(),
    { includeChats: true },
    PROJECT_EXPORT_TEST_DATE,
    createChatAssetBundle()
  ).archive;
}

function createChatAssetBundle(): CollectedPortableBinaryAssets {
  return createBundle(CHAT_ASSET_BYTES, {
    binding: {
      kind: "message_attachment",
      ordinal: 0,
      sourceMessageId: "message-1",
    },
    mimeType: "image/png",
    originalName: "checkout.png",
    path: "assets/001-checkout.png",
    purpose: "CHAT_ATTACHMENT",
    sourceAssetId: "asset-1",
  });
}

function createDocumentAssetBundle(): CollectedPortableBinaryAssets {
  return createBundle(DOCUMENT_ASSET_BYTES, {
    binding: {
      kind: "project_document_source",
      sourceDocumentId: "document-1",
    },
    mimeType: "application/json",
    originalName: "requirements.json",
    path: "assets/001-requirements.json",
    purpose: "PROJECT_DOCUMENT_SOURCE",
    sourceAssetId: "asset-document-1",
  });
}

function createBundle(
  bytes: Uint8Array,
  input: {
    binding: PortableBinaryAssetDescriptor["binding"];
    mimeType: string;
    originalName: string;
    path: string;
    purpose: PortableBinaryAssetDescriptor["purpose"];
    sourceAssetId: string;
  }
): CollectedPortableBinaryAssets {
  const hex = createHash("sha256").update(bytes).digest("hex");
  const base64 = createHash("sha256").update(bytes).digest("base64");
  const descriptor: PortableBinaryAssetDescriptor = {
    binding: input.binding,
    checksumSha256: base64,
    file: {
      path: input.path,
      sha256: hex,
      sizeBytes: bytes.byteLength,
    },
    mimeType: input.mimeType,
    originalName: input.originalName,
    purpose: input.purpose,
    sizeBytes: bytes.byteLength,
    sourceAssetId: input.sourceAssetId,
    sourceProjectId: "project-1",
  };

  return {
    assets: [descriptor],
    entries: new Map([[input.path, bytes]]),
    totalBytes: bytes.byteLength,
  };
}

function rewriteV2Archive(
  archive: Buffer,
  mutate: (
    entries: Record<string, Uint8Array>,
    manifest: Record<string, unknown>
  ) => void
) {
  const entries = unzipSync(archive);
  const manifest = readJsonEntry(entries, "manifest.json");
  mutate(entries, manifest);
  entries["manifest.json"] = encodeJson(manifest);
  return Buffer.from(zipSync(entries));
}

function refreshManifestFile(
  manifest: Record<string, unknown>,
  entries: Record<string, Uint8Array>,
  path: string
) {
  const bytes = entries[path];
  assert.ok(bytes);
  const file = (
    manifest.files as Array<{ path: string; sha256: string; sizeBytes: number }>
  ).find((candidate) => candidate.path === path);
  assert.ok(file);
  file.sha256 = createHash("sha256").update(bytes).digest("hex");
  file.sizeBytes = bytes.byteLength;
}

function readJsonEntry(
  entries: Record<string, Uint8Array>,
  path: string
): Record<string, unknown> {
  const entry = entries[path];
  assert.ok(entry);
  return JSON.parse(strFromU8(entry)) as Record<string, unknown>;
}

function encodeJson(value: unknown) {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function createMinimalPng(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function assertInvalidPackage(run: () => unknown) {
  assert.throws(
    run,
    (error: unknown) =>
      hasCode(error, "PROJECT_IMPORT_PACKAGE_INVALID") &&
      (error as { statusCode?: unknown }).statusCode === 400
  );
}

function hasCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<string, unknown>).code === code
  );
}
