import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { readSafeZip } from "../src/modules/data-portability/safe-zip.ts";

const INVALID_ZIP = {
  code: "TEST_ZIP_INVALID",
  message: "ZIP is invalid.",
};
const TEST_LIMITS = {
  maxCompressedBytes: 10_000,
  maxEntries: 3,
  maxEntryBytes: 1_000,
  maxNestingDepth: 3,
  maxPathChars: 80,
  maxTotalUncompressedBytes: 1_200,
};

describe("safe ZIP reader", () => {
  it("rejects declared uncompressed data over the limit before extraction", () => {
    const archive = createZip({
      "conversations.json": "x".repeat(700),
      "conversations-2.json": "y".repeat(700),
    });

    assert.throws(
      () => readSafeZip(archive, TEST_LIMITS, INVALID_ZIP),
      hasCode(INVALID_ZIP.code)
    );
  });

  it("rejects entry-count, nesting, and backslash path violations", () => {
    assert.throws(
      () =>
        readSafeZip(
          createZip({
            "1.json": "{}",
            "2.json": "{}",
            "3.json": "{}",
            "4.json": "{}",
          }),
          TEST_LIMITS,
          INVALID_ZIP
        ),
      hasCode(INVALID_ZIP.code)
    );
    assert.throws(
      () =>
        readSafeZip(
          createZip({
            "a/b/c/conversations.json": "[]",
          }),
          TEST_LIMITS,
          INVALID_ZIP
        ),
      hasCode(INVALID_ZIP.code)
    );
    assert.throws(
      () =>
        readSafeZip(
          createZip({
            "folder\\conversations.json": "[]",
          }),
          TEST_LIMITS,
          INVALID_ZIP
        ),
      hasCode(INVALID_ZIP.code)
    );
  });

  it("rejects Unix symlink entries", () => {
    const archive = createZip({
      "conversations.json": "[]",
    });
    markFirstCentralDirectoryEntryAsSymlink(archive);

    assert.throws(
      () => readSafeZip(archive, TEST_LIMITS, INVALID_ZIP),
      hasCode(INVALID_ZIP.code)
    );
  });
});

function createZip(entries: Record<string, string>) {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([path, content]) => [
          path,
          strToU8(content),
        ])
      )
    )
  );
}

function markFirstCentralDirectoryEntryAsSymlink(archive: Buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const offset = archive.indexOf(signature);
  assert.ok(offset >= 0);

  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  );
  view.setUint16(offset + 4, (3 << 8) | 20, true);
  view.setUint32(offset + 38, 0xa1ff << 16, true);
}

function hasCode(expectedCode: string) {
  return (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === expectedCode
    );
}
