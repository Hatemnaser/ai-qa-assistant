import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completeAssetSchema, initiateAssetSchema } from "../src/modules/assets/assets.schema.ts";

const CHECKSUM = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=";

describe("private asset schemas", () => {
  it("rejects unknown fields, unsafe names, and non-SHA-256 checksums", () => {
    const valid = {
      checksumSha256: CHECKSUM,
      declaredMimeType: "text/plain",
      expectedSizeBytes: 128,
      originalName: "notes.txt",
      projectId: null,
      purpose: "CHAT_ATTACHMENT" as const,
    };

    assert.equal(initiateAssetSchema.parse(valid).declaredMimeType, "text/plain");
    assert.throws(() => initiateAssetSchema.parse({ ...valid, objectKey: "attacker-key" }));
    assert.throws(() => initiateAssetSchema.parse({ ...valid, originalName: "../notes.txt" }));
    assert.throws(() => initiateAssetSchema.parse({ ...valid, checksumSha256: "not-a-checksum" }));
    assert.throws(() => completeAssetSchema.parse({ checksumSha256: CHECKSUM, objectKey: "attacker-key" }));
  });
});
