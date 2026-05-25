import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRequestHistory } from "../src/features/chat/chatMessages";
import { createChat } from "../src/features/chat/chatStorage";

describe("chat messages", () => {
  it("keeps system error replies out of request history", () => {
    const chat = createChat({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Generate test cases for login",
          mode: "test_cases",
          model: "gemini-2.5-flash",
          createdAt: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "assistant-error",
          role: "assistant",
          content: "Daily demo credit limit reached. Sign in for more credits or try again later.",
          mode: "test_cases",
          model: "gemini-2.5-flash",
          createdAt: "2026-05-20T00:01:00.000Z",
          isError: true,
        },
        {
          id: "user-2",
          role: "user",
          content: "I signed in now, continue",
          mode: "general",
          model: "gemini-2.5-flash",
          createdAt: "2026-05-20T00:02:00.000Z",
        },
      ],
    });

    const history = buildRequestHistory(chat);

    assert.deepEqual(
      history.map((message) => message.content),
      ["Generate test cases for login", "I signed in now, continue"]
    );
  });

  it("filters old unflagged system error replies from request history", () => {
    const chat = createChat({
      messages: [
        {
          id: "assistant-error",
          role: "assistant",
          content: "Daily demo credit limit reached. Sign in for more credits or try again later.",
          mode: "general",
          model: "gemini-2.5-flash",
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
    });

    assert.deepEqual(buildRequestHistory(chat), []);
  });
});
