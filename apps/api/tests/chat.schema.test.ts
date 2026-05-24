import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHAT_ATTACHMENT_LIMITS, MAX_INLINE_IMAGE_BASE64_CHARS } from "../src/modules/chat/chat.attachments.ts";
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
});

function createChatRequest(overrides: Record<string, unknown> = {}) {
  return {
    history: [],
    message: "Review this",
    mode: "general",
    ...overrides,
  };
}
