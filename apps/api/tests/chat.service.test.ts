import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatService } from "../src/modules/chat/chat.service.ts";

describe("chat service", () => {
  it("returns the stable chat response contract", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.equal(input.message, "hello");
        assert.equal(input.mode, "general");
        assert.equal(input.model, "gemini-2.5-flash-lite");

        return {
          reply: "Hi from test AI",
          model: "gemini-2.5-flash-lite",
        };
      },
    });

    const response = await service.createChatReply({
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash-lite",
    });

    assert.deepEqual(response, {
      reply: "Hi from test AI",
      mode: "general",
      model: "gemini-2.5-flash-lite",
    });
  });

  it("rejects unsupported models before calling the AI provider", async () => {
    let providerWasCalled = false;
    const service = createChatService({
      chatWithAi: async () => {
        providerWasCalled = true;
        return {
          reply: "should not happen",
          model: "gemini-2.5-flash",
        };
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply({
          history: [],
          message: "hello",
          mode: "general",
          model: "not-a-real-model",
        }),
      {
        code: "UNSUPPORTED_MODEL",
        statusCode: 400,
      }
    );
    assert.equal(providerWasCalled, false);
  });
});
