import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSupportedAsset, detectAssetMime } from "../src/modules/assets/assets.policy.ts";

describe("private asset policy", () => {
  it("detects supported image magic bytes", () => {
    assert.equal(
      detectAssetMime(createPngHeader(16, 16), "image/png"),
      "image/png"
    );
    assert.equal(detectAssetMime(createJpegHeader(16, 16), "image/jpeg"), "image/jpeg");
    assert.equal(detectAssetMime(new TextEncoder().encode("not an image"), "image/png"), null);
    assert.equal(detectAssetMime(createPngHeader(10_000, 10), "image/png"), null);
  });

  it("accepts valid UTF-8 text and rejects binary/NUL payloads", () => {
    assert.equal(detectAssetMime(new TextEncoder().encode("# Requirements\n✓"), "text/markdown"), "text/markdown");
    assert.equal(detectAssetMime(Uint8Array.from([0x61, 0, 0x62]), "text/plain"), null);
    assert.equal(detectAssetMime(Uint8Array.from([0xc3, 0x28]), "text/plain"), null);
    assert.equal(detectAssetMime(new TextEncoder().encode('{"ok":true}'), "application/json"), "application/json");
    assert.equal(detectAssetMime(new TextEncoder().encode("not json"), "application/json"), null);
  });

  it("enforces purpose, MIME, and conservative release sizes", () => {
    assert.doesNotThrow(() =>
      assertSupportedAsset({
        maxImageBytes: 4_194_304,
        maxTextBytes: 1_048_576,
        mimeType: "image/png",
        originalName: "screen.png",
        purpose: "CHAT_ATTACHMENT",
        sizeBytes: 500,
      })
    );
    assert.throws(
      () =>
        assertSupportedAsset({
          maxImageBytes: 4_194_304,
          maxTextBytes: 1_048_576,
          mimeType: "image/png",
          originalName: "screen.png",
          purpose: "PROJECT_DOCUMENT_SOURCE",
          sizeBytes: 500,
        }),
      /must be text files/
    );
    assert.throws(
      () =>
        assertSupportedAsset({
          maxImageBytes: 4_194_304,
          maxTextBytes: 1_048_576,
          mimeType: "application/pdf",
          originalName: "report.pdf",
          purpose: "CHAT_ATTACHMENT",
          sizeBytes: 500,
        }),
      /Unsupported asset type/
    );
    for (const [originalName, mimeType] of [
      ["events.log", "text/plain"],
      ["page.html", "text/html"],
      ["theme.css", "text/css"],
      ["script.js", "text/javascript"],
      ["types.ts", "text/typescript"],
    ]) {
      assert.doesNotThrow(() => assertSupportedAsset({
        maxImageBytes: 4_194_304,
        maxTextBytes: 1_048_576,
        mimeType,
        originalName,
        purpose: "PROJECT_DOCUMENT_SOURCE",
        sizeBytes: 500,
      }));
    }
    assert.throws(() => assertSupportedAsset({
      maxImageBytes: 4_194_304,
      maxTextBytes: 1_048_576,
      mimeType: "text/markdown",
      originalName: "large.md",
      purpose: "PROJECT_DOCUMENT_SOURCE",
      sizeBytes: 250_001,
    }), /too large/);
  });
});

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

function createJpegHeader(width: number, height: number) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}
