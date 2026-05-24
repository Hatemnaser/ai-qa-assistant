import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ATTACHMENT_INPUT_ACCEPT, getAttachmentFileError } from "../src/features/chat/chatAttachments";

describe("chat attachments", () => {
  it("accepts supported image files", () => {
    const file = { name: "screen.png", size: 1024, type: "image/png" } as File;

    assert.equal(getAttachmentFileError(file), "");
  });

  it("accepts supported text and data files", () => {
    const file = { name: "requirements.md", size: 1024, type: "" } as File;

    assert.equal(getAttachmentFileError(file), "");
  });

  it("keeps PDF and video behind the future file-upload path", () => {
    const file = { name: "requirements.pdf", size: 1024, type: "application/pdf" } as File;

    assert.match(getAttachmentFileError(file), /next version/i);
  });

  it("exposes the supported picker accept list", () => {
    assert.match(ATTACHMENT_INPUT_ACCEPT, /image\/png/);
    assert.match(ATTACHMENT_INPUT_ACCEPT, /\.md/);
    assert.match(ATTACHMENT_INPUT_ACCEPT, /\.json/);
  });
});
