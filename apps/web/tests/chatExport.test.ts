import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DEFAULT_MODE, DEFAULT_MODEL } from "../src/features/chat/constants";
import { parseImportedChatJson } from "../src/features/chat/chatExport";

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "generated-chat-id",
    },
  });
});

describe("chat export/import helpers", () => {
  it("parses wrapped exported chat JSON into a normalized chat", () => {
    const chat = parseImportedChatJson(
      JSON.stringify({
        type: "qa-chat",
        chat: {
          id: "original-id",
          title: "  Exported chat with a very normal title  ",
          mode: "bug_report",
          model: "gemini-2.5-flash-lite",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          messages: [
            {
              id: "old-message-id",
              role: "assistant",
              content: "Bug report content",
              mode: "bug_report",
              model: "gemini-2.5-flash-lite",
              createdAt: "2026-01-01T01:00:00.000Z",
              attachment: {
                type: "image",
                name: "screen.png",
                mimeType: "image/png",
                previewUrl: "data:image/png;base64,abc",
              },
            },
          ],
        },
      })
    );

    assert.equal(chat.id, "generated-chat-id");
    assert.equal(chat.title, "Exported chat with a very normal title");
    assert.equal(chat.mode, "bug_report");
    assert.equal(chat.model, "gemini-2.5-flash-lite");
    assert.equal(chat.messages[0]?.id, "generated-chat-id");
    assert.equal(chat.messages[0]?.role, "assistant");
    assert.equal(chat.messages[0]?.attachments?.[0]?.name, "screen.png");
    assert.equal(chat.messages[0]?.attachments?.[0]?.previewUrl, undefined);
  });

  it("uses safe defaults for minimal raw chat JSON", () => {
    const chat = parseImportedChatJson(
      JSON.stringify({
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      })
    );

    assert.equal(chat.title, "Imported QA Chat");
    assert.equal(chat.mode, DEFAULT_MODE);
    assert.equal(chat.model, DEFAULT_MODEL);
    assert.equal(chat.messages[0]?.mode, DEFAULT_MODE);
    assert.equal(chat.messages[0]?.model, DEFAULT_MODEL);
  });

  it("rejects invalid chat import files", () => {
    assert.throws(() => parseImportedChatJson("{not-json"), /Invalid JSON file/);
    assert.throws(() => parseImportedChatJson(JSON.stringify({ title: "No messages" })), /chat object/);
    assert.throws(
      () =>
        parseImportedChatJson(
          JSON.stringify({
            messages: [{ role: "system", content: "bad role" }],
          })
        ),
      /user or assistant role/
    );
  });
});
