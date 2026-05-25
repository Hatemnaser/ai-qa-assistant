import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_SUPPORTED_IMAGE_MIME_TYPES,
  CHAT_SUPPORTED_TEXT_EXTENSIONS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "../src/modules/chat/chat.attachments.ts";
import { chatRequestSchema } from "../src/modules/chat/chat.schema.ts";

describe("chat request schema", () => {
  it("rejects unsupported image mime types", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: [
          {
            type: "image",
            mimeType: "image/gif",
            data: "abc",
          },
        ],
      })
    );

    assert.equal(result.success, false);
  });

  it("rejects inline image data over the supported image limit", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            data: "a".repeat(MAX_INLINE_IMAGE_BASE64_CHARS + 1),
          },
        ],
      })
    );

    assert.equal(result.success, false);
  });

  it("accepts supported text and data file attachments", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: [
          {
            type: "file",
            name: "requirements.md",
            mimeType: "text/markdown",
            content: "# Checkout requirements",
          },
          {
            type: "file",
            name: "logs.log",
            mimeType: "application/octet-stream",
            content: "error=true",
          },
        ],
      })
    );

    assert.equal(result.success, true);
  });

  it("rejects unsupported file attachment types", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: [
          {
            type: "file",
            name: "requirements.pdf",
            mimeType: "application/pdf",
            content: "fake pdf text",
          },
        ],
      })
    );

    assert.equal(result.success, false);
  });

  it("does not treat extensionless file names as supported extensions", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: [
          {
            type: "file",
            name: "json",
            mimeType: "application/octet-stream",
            content: "not really json",
          },
        ],
      })
    );

    assert.equal(result.success, false);
  });

  it("keeps attachment limits centralized", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        attachments: Array.from(
          { length: CHAT_ATTACHMENT_LIMITS.maxAttachments + 1 },
          (_, index) => ({
            type: "file",
            name: `file-${index}.txt`,
            mimeType: "text/plain",
            content: "hello",
          })
        ),
      })
    );

    assert.equal(result.success, false);
  });

  it("documents the public inline attachment policy", () => {
    assert.equal(CHAT_ATTACHMENT_LIMITS.maxAttachments, 4);
    assert.equal(CHAT_ATTACHMENT_LIMITS.maxInlineImageBytes, 4 * 1024 * 1024);
    assert.equal(CHAT_ATTACHMENT_LIMITS.maxTextContentChars, 1_000_000);
    assert.deepEqual([...CHAT_SUPPORTED_IMAGE_MIME_TYPES], ["image/png", "image/jpeg", "image/webp"]);
    assert.deepEqual([...CHAT_SUPPORTED_TEXT_EXTENSIONS], ["txt", "md", "log", "csv", "json"]);
  });
});

function createChatRequest(overrides: Record<string, unknown> = {}) {
  return {
    history: [],
    message: "Review this",
    mode: "general",
    ...overrides,
  };
}
