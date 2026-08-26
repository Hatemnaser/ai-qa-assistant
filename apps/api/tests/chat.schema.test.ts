import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { env } from "../src/config/env.ts";
import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_SUPPORTED_IMAGE_MIME_TYPES,
  CHAT_SUPPORTED_TEXT_EXTENSIONS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "../src/modules/chat/chat.attachments.ts";
import { chatRequestSchema } from "../src/modules/chat/chat.schema.ts";

describe("chat request schema", () => {
  it("normalizes optional chat identity", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        chatId: " chat-1 ",
      })
    );

    assert.equal(result.success, true);
    assert.equal(result.data?.chatId, "chat-1");
  });

  it("strips frontend-supplied identity fields", () => {
    const result = chatRequestSchema.parse(
      createChatRequest({
        accountId: "account-from-body",
        guestId: "guest-from-body",
        ownerId: "owner-from-body",
        userId: "user-from-body",
      })
    ) as Record<string, unknown>;

    assert.equal("accountId" in result, false);
    assert.equal("guestId" in result, false);
    assert.equal("ownerId" in result, false);
    assert.equal("userId" in result, false);
  });

  it("rejects messages over the configured message limit", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        message: "a".repeat(env.maxMessageChars + 1),
      })
    );

    assert.equal(result.success, false);
  });

  it("rejects history over the configured history limit", () => {
    const result = chatRequestSchema.safeParse(
      createChatRequest({
        history: Array.from({ length: env.maxHistoryMessages + 1 }, (_, index) => ({
          content: `Message ${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
        })),
      })
    );

    assert.equal(result.success, false);
  });

  it("rejects unsupported modes and providers", () => {
    assert.equal(
      chatRequestSchema.safeParse(createChatRequest({ mode: "ignore_previous_instructions" })).success,
      false
    );
    assert.equal(
      chatRequestSchema.safeParse(createChatRequest({ provider: "unbounded-provider" })).success,
      false
    );
  });

  it("bounds individual and total history content", () => {
    const oversizedItem = chatRequestSchema.safeParse(
      createChatRequest({
        history: [{ content: "a".repeat(env.maxMessageChars + 1), role: "user" }],
      })
    );
    const messageLength = Math.min(env.maxMessageChars, 2500);
    const messageCount = Math.min(
      env.maxHistoryMessages,
      Math.floor(env.maxHistoryTotalChars / messageLength) + 1
    );
    const oversizedTotal = chatRequestSchema.safeParse(
      createChatRequest({
        history: Array.from({ length: messageCount }, (_, index) => ({
          content: "a".repeat(messageLength),
          role: index % 2 === 0 ? "user" : "assistant",
        })),
      })
    );

    assert.equal(oversizedItem.success, false);
    assert.equal(oversizedTotal.success, false);
  });

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

  it("accepts opaque stored attachment references and rejects duplicate ids", () => {
    assert.equal(
      chatRequestSchema.safeParse(createChatRequest({
        attachments: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
      })).success,
      true
    );
    assert.equal(
      chatRequestSchema.safeParse(createChatRequest({
        attachments: [{ assetId: "asset-1" }, { assetId: "asset-1" }],
      })).success,
      false
    );
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
