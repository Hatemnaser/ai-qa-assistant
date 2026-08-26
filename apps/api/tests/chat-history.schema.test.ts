import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_LIMITS } from "../src/config/data-limits.ts";
import { storedChatSchema } from "../src/modules/chat-history/chat-history.schema.ts";

describe("stored chat limits", () => {
  it("accepts a bounded saved chat", () => {
    assert.equal(storedChatSchema.safeParse(createChat(2, "hello")).success, true);
  });

  it("rejects more than the per-chat message limit", () => {
    assert.equal(
      storedChatSchema.safeParse(
        createChat(DATA_LIMITS.messagesPerChat + 1, "message")
      ).success,
      false
    );
  });

  it("rejects saved chats whose aggregate UTF-8 message content is too large", () => {
    const content = "a".repeat(DATA_LIMITS.chatMessageContentChars);
    const count = Math.floor(DATA_LIMITS.chatMessageContentBytesPerChat / content.length) + 1;

    assert.equal(storedChatSchema.safeParse(createChat(count, content)).success, false);
  });
});

function createChat(messageCount: number, content: string) {
  return {
    id: "chat-1",
    projectId: null,
    title: "Bounded chat",
    mode: "general",
    model: "gemini-3.1-flash-lite",
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      mode: "general",
      model: "gemini-3.1-flash-lite",
    })),
  };
}
