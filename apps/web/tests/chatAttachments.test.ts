import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAttachmentFileError } from "../src/features/chat/chatAttachments";

describe("chat attachments", () => {
  it("accepts supported image files", () => {
    const file = { size: 1024, type: "image/png" } as File;

    assert.equal(getAttachmentFileError(file), "");
  });

  it("keeps non-image files behind the future file-upload path", () => {
    const file = { size: 1024, type: "application/pdf" } as File;

    assert.match(getAttachmentFileError(file), /coming soon/i);
  });
});
