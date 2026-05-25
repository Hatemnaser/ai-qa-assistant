import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTACHMENT_INPUT_ACCEPT,
  CHAT_ATTACHMENT_POLICY,
  getAttachmentFileError,
} from "../src/features/chat/chatAttachments";

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

  it("does not treat extensionless file names as supported extensions", () => {
    const file = { name: "json", size: 1024, type: "application/octet-stream" } as File;

    assert.match(getAttachmentFileError(file), /Please upload/);
  });

  it("keeps attachment limits in one frontend policy", () => {
    assert.equal(CHAT_ATTACHMENT_POLICY.maxAttachments, 4);
    assert.equal(CHAT_ATTACHMENT_POLICY.maxImageBytes, 4 * 1024 * 1024);
    assert.equal(CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes, 1_000_000);
  });

  it("rejects text files over the API inline text limit", () => {
    const file = { name: "requirements.md", size: 1_000_001, type: "text/markdown" } as File;

    assert.match(getAttachmentFileError(file), /smaller than 1\.0MB/);
  });

  it("exposes the supported picker accept list", () => {
    assert.match(ATTACHMENT_INPUT_ACCEPT, /image\/png/);
    assert.match(ATTACHMENT_INPUT_ACCEPT, /\.md/);
    assert.match(ATTACHMENT_INPUT_ACCEPT, /\.json/);
  });
});
