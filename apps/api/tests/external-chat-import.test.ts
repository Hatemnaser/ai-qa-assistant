import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { strToU8, zipSync } from "fflate";

import { validateExternalChatImport } from "../src/modules/data-portability/external-chat-adapters.ts";

describe("external chat import adapters", () => {
  it("auto-detects and parses the active ChatGPT conversation branch", () => {
    const archive = createChatGptExport();
    const result = validateExternalChatImport(archive, "auto");

    assert.equal(result.provider, "chatgpt");
    assert.equal(
      result.packageDigest,
      createHash("sha256").update(archive).digest("hex")
    );
    assert.equal(result.chats.length, 1);
    assert.equal(result.chats[0]?.title, "Checkout help");
    assert.deepEqual(
      result.chats[0]?.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      [
        {
          role: "user",
          content: "Help me test checkout.",
        },
        {
          role: "assistant",
          content: "Start with the payment paths.",
        },
      ]
    );
  });

  it("parses Claude export conversations and reports unsupported attachments", () => {
    const result = validateExternalChatImport(createClaudeExport(), "claude");

    assert.equal(result.provider, "claude");
    assert.equal(result.chats.length, 1);
    assert.deepEqual(
      result.chats[0]?.messages.map((message) => message.role),
      ["user", "assistant"]
    );
    assert.match(result.warnings.join(" "), /attachment/i);
  });

  it("rejects provider mismatches, malformed JSON, and missing conversation files safely", () => {
    assert.throws(
      () => validateExternalChatImport(createClaudeExport(), "chatgpt"),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
    assert.throws(
      () =>
        validateExternalChatImport(
          createZip({
            "conversations.json": "{broken",
          }),
          "auto"
        ),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
    assert.throws(
      () =>
        validateExternalChatImport(
          createZip({
            "account.json": "{}",
          }),
          "auto"
        ),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("rejects unsafe ZIP paths before reading provider data", () => {
    assert.throws(
      () =>
        validateExternalChatImport(
          createZip({
            "../conversations.json": JSON.stringify([]),
          }),
          "chatgpt"
        ),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
    assert.throws(
      () =>
        validateExternalChatImport(
          createZip({
            "C:/conversations.json": JSON.stringify([]),
          }),
          "chatgpt"
        ),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
    assert.throws(
      () =>
        validateExternalChatImport(
          createZip({
            "Conversations.json": JSON.stringify([]),
            "conversations.json": JSON.stringify([]),
          }),
          "chatgpt"
        ),
      hasCode("EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID")
    );
  });

  it("sanitizes trace fields and reports skipped unsupported messages", () => {
    const result = validateExternalChatImport(
      createZip({
        "conversations.json": JSON.stringify([
          {
            id: `source\u0000-${"x".repeat(300)}`,
            title: "Imported\u0000 title",
            create_time: Number.MAX_SAFE_INTEGER,
            current_node: "user-node",
            mapping: {
              "tool-node": {
                id: "tool-node",
                parent: null,
                message: {
                  author: { role: "tool" },
                  content: { parts: ["internal tool output"] },
                },
              },
              "user-node": {
                id: "user-node",
                parent: "tool-node",
                message: {
                  id: "user-message",
                  author: { role: "user" },
                  content: { parts: ["Hello\u0000world"] },
                },
              },
            },
          },
        ]),
      }),
      "chatgpt"
    );

    assert.equal(result.chats[0]?.sourceId.length, 240);
    assert.equal(result.chats[0]?.title, "Imported title");
    assert.equal(result.chats[0]?.createdAt, null);
    assert.equal(result.chats[0]?.messages[0]?.content, "Hello�world");
    assert.match(result.warnings.join(" "), /unsupported message/i);
  });

});

export function createChatGptExport() {
  return createZip({
    "conversations.json": JSON.stringify([
      {
        id: "conversation-1",
        title: "Checkout help",
        create_time: 1_750_000_000,
        update_time: 1_750_000_100,
        current_node: "assistant-node",
        mapping: {
          "system-node": {
            id: "system-node",
            parent: null,
            message: {
              id: "system-message",
              author: {
                role: "system",
              },
              content: {
                parts: ["System context"],
              },
              create_time: 1_750_000_000,
            },
          },
          "user-node": {
            id: "user-node",
            parent: "system-node",
            message: {
              id: "user-message",
              author: {
                role: "user",
              },
              content: {
                parts: ["Help me test checkout."],
              },
              create_time: 1_750_000_010,
            },
          },
          "assistant-node": {
            id: "assistant-node",
            parent: "user-node",
            message: {
              id: "assistant-message",
              author: {
                role: "assistant",
              },
              content: {
                parts: ["Start with the payment paths."],
              },
              create_time: 1_750_000_020,
              metadata: {
                model_slug: "gpt-test",
              },
            },
          },
          "unused-branch": {
            id: "unused-branch",
            parent: "user-node",
            message: {
              id: "unused-message",
              author: {
                role: "assistant",
              },
              content: {
                parts: ["Unused branch"],
              },
              create_time: 1_750_000_030,
            },
          },
        },
      },
    ]),
    "user.json": JSON.stringify({
      email: "source@example.com",
    }),
  });
}

export function createClaudeExport() {
  return createZip({
    "conversations.json": JSON.stringify([
      {
        uuid: "claude-conversation-1",
        name: "Release review",
        created_at: "2026-07-01T10:00:00.000Z",
        updated_at: "2026-07-01T10:05:00.000Z",
        chat_messages: [
          {
            uuid: "claude-message-1",
            sender: "human",
            text: "Review this release.",
            created_at: "2026-07-01T10:00:00.000Z",
            attachments: [
              {
                file_name: "release.txt",
              },
            ],
          },
          {
            uuid: "claude-message-2",
            sender: "assistant",
            text: "I will review it.",
            created_at: "2026-07-01T10:00:10.000Z",
          },
        ],
      },
    ]),
  });
}

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

function hasCode(expectedCode: string) {
  return (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === expectedCode
    );
}
