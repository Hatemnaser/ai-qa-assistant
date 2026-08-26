import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  strFromU8,
  strToU8,
  unzipSync,
  Zip,
  zipSync,
  ZipPassThrough,
} from "fflate";

import { createDataPortabilityService } from "../src/modules/data-portability/data-portability.service.ts";
import { previewProjectImportPackage } from "../src/modules/data-portability/import-package.ts";
import {
  PROJECT_IMPORT_LIMITS,
  type DataPortabilityRepository,
} from "../src/modules/data-portability/data-portability.types.ts";
import { createTestProjectExportArchive } from "./helpers/projectExportPackage.ts";

describe("project import preview", () => {
  it("previews a valid Project Portable ZIP", () => {
    const archive = createTestProjectExportArchive();
    const preview = previewProjectImportPackage(archive);

    assert.deepEqual(preview, {
      compatible: true,
      formatVersion: "1.0",
      exportType: "project",
      packageDigest: createHash("sha256").update(archive).digest("hex"),
      suggestedProjectName: "Checkout QA (Imported)",
      sourceProjectName: "Checkout QA",
      counts: {
        documents: 1,
        chats: 1,
        messages: 2,
      },
      warnings: [
        "Chat attachment metadata is included, but original attachment files are not included in this archive.",
        "Private object-storage binaries are not included in this legacy version 1 archive. Export again with available private assets to create a version 2 archive.",
      ],
      unsupported: [],
    });
  });

  it("rejects malformed ZIP bytes safely", () => {
    assertInvalidPackage(() => previewProjectImportPackage(Buffer.alloc(0)));
    assertInvalidPackage(() => previewProjectImportPackage(Buffer.from("not-a-zip")));
  });

  it("rejects a missing manifest.json", () => {
    const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
      delete entries["manifest.json"];
    });

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects an unsupported formatVersion", () => {
    const archive = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "manifest.json",
      (manifest) => ({
        ...manifest,
        formatVersion: "2.0",
      })
    );

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects the wrong exportType", () => {
    const archive = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "manifest.json",
      (manifest) => ({
        ...manifest,
        exportType: "account",
      })
    );

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects unsupported manifest fields instead of ignoring them", () => {
    const archive = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "manifest.json",
      (manifest) => ({
        ...manifest,
        futureWriteInstruction: "ignore validation",
      })
    );

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects a missing data/project.json", () => {
    const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
      delete entries["data/project.json"];
    });

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects malformed project JSON", () => {
    const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
      entries["data/project.json"] = strToU8("{broken-json");
    });

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects parent and absolute path traversal entries", () => {
    for (const path of ["../outside.txt", "/absolute.txt"]) {
      const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
        entries[path] = strToU8("unsafe");
      });

      assertInvalidPackage(() => previewProjectImportPackage(archive));
    }
  });

  it("rejects Windows-style paths and backslash traversal", () => {
    for (const path of ["C:\\secrets.txt", "..\\outside.txt", "documents\\file.txt"]) {
      const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
        entries[path] = strToU8("unsafe");
      });

      assertInvalidPackage(() => previewProjectImportPackage(archive));
    }
  });

  it("rejects duplicate and case-conflicting ZIP paths", () => {
    const baseEntries = Object.entries(unzipSync(createTestProjectExportArchive()));
    const exactDuplicate = createZipWithEntries([
      ...baseEntries,
      ["notes.txt", strToU8("one")],
      ["notes.txt", strToU8("two")],
    ]);
    const caseConflict = createZipWithEntries([
      ...baseEntries,
      ["Notes.txt", strToU8("one")],
      ["notes.txt", strToU8("two")],
    ]);

    assertInvalidPackage(() => previewProjectImportPackage(exactDuplicate));
    assertInvalidPackage(() => previewProjectImportPackage(caseConflict));
  });

  it("rejects executable Unix ZIP entries", () => {
    const archive = patchFirstCentralDirectoryEntry(
      createTestProjectExportArchive(),
      (patched, cursor) => {
        patched.writeUInt16LE((3 << 8) | 20, cursor + 4);
        patched.writeUInt32LE((0o100755 << 16) >>> 0, cursor + 38);
      }
    );

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects executable and nested-archive file extensions", () => {
    for (const path of ["payload.exe", "nested.zip"]) {
      const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
        entries[path] = strToU8("unsafe");
      });

      assertInvalidPackage(() => previewProjectImportPackage(archive));
    }
  });

  it("rejects a manifest SHA-256 mismatch", () => {
    const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
      entries["readable/project.md"] = strToU8("# Changed after export\n");
    });

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects manifest count mismatches", () => {
    const archive = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "manifest.json",
      (manifest) => ({
        ...manifest,
        counts: {
          ...(manifest.counts as Record<string, unknown>),
          messages: 999,
        },
      })
    );

    assertInvalidPackage(() => previewProjectImportPackage(archive));
  });

  it("rejects referenced document files that are missing or undeclared", () => {
    const missing = rewriteZip(createTestProjectExportArchive(), (entries) => {
      delete entries["documents/001-requirements.json"];
    });
    const undeclared = rewriteJsonEntry(
      createTestProjectExportArchive(),
      "manifest.json",
      (manifest) => ({
        ...manifest,
        files: (manifest.files as Array<{ path: string }>).filter(
          (file) => file.path !== "documents/001-requirements.json"
        ),
      })
    );

    assertInvalidPackage(() => previewProjectImportPackage(missing));
    assertInvalidPackage(() => previewProjectImportPackage(undeclared));
  });

  it("reports safe unrecognized entries instead of silently ignoring them", () => {
    const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
      entries["notes.txt"] = strToU8("extra portable note");
    });
    const preview = previewProjectImportPackage(archive);

    assert.deepEqual(preview.unsupported, ["Unrecognized ZIP entry: notes.txt"]);
  });

  it("rejects packages over the compressed-size and entry-count limits", () => {
    assertInvalidPackage(() =>
      previewProjectImportPackage(
        Buffer.alloc(PROJECT_IMPORT_LIMITS.maxCompressedBytes + 1)
      )
    );

    const entries = Object.fromEntries(
      Array.from({ length: PROJECT_IMPORT_LIMITS.maxEntries + 1 }, (_, index) => [
        `entry-${index}.txt`,
        strToU8(""),
      ])
    );

    assertInvalidPackage(() =>
      previewProjectImportPackage(Buffer.from(zipSync(entries)))
    );
  });

  it("rejects entries over the individual and total uncompressed-size limits", () => {
    const individualArchive = patchCentralDirectoryUncompressedSizes(
      Buffer.from(
        zipSync({
          "entry.txt": strToU8("small"),
        })
      ),
      [PROJECT_IMPORT_LIMITS.maxEntryBytes + 1]
    );
    const totalArchive = patchCentralDirectoryUncompressedSizes(
      Buffer.from(
        zipSync(
          Object.fromEntries(
            Array.from({ length: 9 }, (_, index) => [
              `entry-${index}.txt`,
              strToU8("small"),
            ])
          )
        )
      ),
      Array(9).fill(PROJECT_IMPORT_LIMITS.maxEntryBytes)
    );

    assertInvalidPackage(() => previewProjectImportPackage(individualArchive));
    assertInvalidPackage(() => previewProjectImportPackage(totalArchive));
  });

  it("rejects paths over the character and nesting-depth limits", () => {
    const longPath = `${"a".repeat(PROJECT_IMPORT_LIMITS.maxPathChars)}.txt`;
    const deepPath = `${Array(PROJECT_IMPORT_LIMITS.maxNestingDepth + 1)
      .fill("level")
      .join("/")}.txt`;

    for (const path of [longPath, deepPath]) {
      const archive = rewriteZip(createTestProjectExportArchive(), (entries) => {
        entries[path] = strToU8("unsafe");
      });

      assertInvalidPackage(() => previewProjectImportPackage(archive));
    }
  });

  it("performs preview without database repository calls or writes", async () => {
    let accessCalls = 0;
    let repositoryCalls = 0;
    const repository: DataPortabilityRepository = {
      async createImportedProject() {
        repositoryCalls += 1;
        throw new Error("Preview must not write to the database.");
      },
      async findOwnedProjectExportData() {
        repositoryCalls += 1;
        throw new Error("Preview must not query the database.");
      },
      async findProjectDocumentIndexStatuses() {
        repositoryCalls += 1;
        throw new Error("Preview must not query document index state.");
      },
    };
    const service = createDataPortabilityService({
      indexer: {
        async ensureDocumentsIndexed() {
          throw new Error("Preview must not index documents.");
        },
        async indexDocument() {
          throw new Error("Preview must not index documents.");
        },
        async indexDocuments() {
          throw new Error("Preview must not index documents.");
        },
      },
      projectAccess: {
        async assertProjectAccess() {
          accessCalls += 1;
          throw new Error("Preview must not load project access.");
        },
      },
      repository,
    });

    const preview = await service.previewProjectImport(createTestProjectExportArchive());

    assert.equal(preview.compatible, true);
    assert.equal(accessCalls, 0);
    assert.equal(repositoryCalls, 0);
  });
});

function rewriteZip(
  archive: Buffer,
  mutate: (entries: Record<string, Uint8Array>) => void
) {
  const entries = unzipSync(archive);
  mutate(entries);

  return Buffer.from(zipSync(entries));
}

function rewriteJsonEntry(
  archive: Buffer,
  path: string,
  mutate: (value: Record<string, unknown>) => Record<string, unknown>
) {
  return rewriteZip(archive, (entries) => {
    const entry = entries[path];
    assert.ok(entry);
    const value = JSON.parse(strFromU8(entry)) as Record<string, unknown>;
    entries[path] = strToU8(`${JSON.stringify(mutate(value), null, 2)}\n`);
  });
}

function createZipWithEntries(entries: Array<[string, Uint8Array]>) {
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      failure = error;
      return;
    }

    chunks.push(chunk);
  });

  for (const [path, content] of entries) {
    const file = new ZipPassThrough(path);
    zip.add(file);
    file.push(content, true);
  }

  zip.end();

  if (failure) throw failure;

  return Buffer.concat(chunks);
}

function patchCentralDirectoryUncompressedSizes(
  archive: Buffer,
  uncompressedSizes: number[]
) {
  const patched = Buffer.from(archive);
  const endOffset = findSignatureFromEnd(patched, 0x06054b50);
  const entryCount = patched.readUInt16LE(endOffset + 10);
  let cursor = patched.readUInt32LE(endOffset + 16);

  assert.equal(entryCount, uncompressedSizes.length);

  for (const size of uncompressedSizes) {
    assert.equal(patched.readUInt32LE(cursor), 0x02014b50);
    patched.writeUInt32LE(size, cursor + 24);

    const fileNameLength = patched.readUInt16LE(cursor + 28);
    const extraLength = patched.readUInt16LE(cursor + 30);
    const commentLength = patched.readUInt16LE(cursor + 32);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return patched;
}

function patchFirstCentralDirectoryEntry(
  archive: Buffer,
  patch: (buffer: Buffer, cursor: number) => void
) {
  const patched = Buffer.from(archive);
  const endOffset = findSignatureFromEnd(patched, 0x06054b50);
  const cursor = patched.readUInt32LE(endOffset + 16);

  assert.equal(patched.readUInt32LE(cursor), 0x02014b50);
  patch(patched, cursor);

  return patched;
}

function findSignatureFromEnd(buffer: Buffer, signature: number) {
  for (let offset = buffer.byteLength - 4; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }

  throw new Error("ZIP signature was not found.");
}

function assertInvalidPackage(run: () => unknown) {
  assert.throws(
    run,
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: unknown }).code === "PROJECT_IMPORT_PACKAGE_INVALID" &&
          "statusCode" in error &&
          (error as { statusCode?: unknown }).statusCode === 400 &&
          "message" in error &&
          (error as { message?: unknown }).message ===
            "Project import package is invalid or unsupported."
      )
  );
}
