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
        assert.equal(input.provider, "gemini");

        return {
          reply: "Hi from test AI",
          model: "gemini-2.5-flash-lite",
          provider: "gemini",
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
      provider: "gemini",
    });
  });

  it("rejects unsupported models before calling the AI provider", async () => {
    let providerWasCalled = false;
    let usageWasReserved = false;
    const service = createChatService({
      chatWithAi: async () => {
        providerWasCalled = true;
        return {
          reply: "should not happen",
          model: "gemini-2.5-flash",
          provider: "gemini",
        };
      },
      reserveUsage: async () => {
        usageWasReserved = true;
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
    assert.equal(usageWasReserved, false);
  });

  it("reserves usage before calling the AI provider", async () => {
    const calls: string[] = [];
    const service = createChatService({
      chatWithAi: async () => {
        calls.push("ai");
        return {
          reply: "Hi from test AI",
          model: "gemini-2.5-flash",
          provider: "gemini",
        };
      },
      reserveUsage: async (identity) => {
        calls.push("usage");
        assert.deepEqual(identity, {
          guestId: "guest-1",
          ipAddress: "127.0.0.1",
          userId: undefined,
        });

        return {
          limit: 3,
          remaining: 2,
          used: 1,
        };
      },
    });

    const response = await service.createChatReply(
      {
        history: [],
        message: "hello",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        guestId: "guest-1",
        ipAddress: "127.0.0.1",
      }
    );

    assert.deepEqual(calls, ["usage", "ai"]);
    assert.deepEqual(response.usage, {
      limit: 3,
      remaining: 2,
      used: 1,
    });
  });

  it("converts image attachments into the provider image payload", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.images, [
          {
            mimeType: "image/png",
            data: "abc",
          },
          {
            mimeType: "image/webp",
            data: "def",
          },
        ]);

        return {
          reply: "Hi from test AI",
          model: "gemini-2.5-flash",
          provider: "gemini",
        };
      },
    });

    await service.createChatReply({
      attachments: [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          data: "abc",
        },
        {
          type: "image",
          name: "wireframe.webp",
          mimeType: "image/webp",
          data: "def",
        },
      ],
      history: [],
      message: "review this",
      mode: "general",
      model: "gemini-2.5-flash",
    });
  });

  it("passes text file attachments to the AI provider", async () => {
    const calls: string[] = [];
    const service = createChatService({
      chatWithAi: async (input) => {
        calls.push("ai");
        assert.deepEqual(input.attachments, [
          {
            type: "file",
            name: "requirements.md",
            mimeType: "text/markdown",
            content: "# Checkout requirements",
          },
        ]);

        return {
          reply: "Hi from test AI",
          model: "gemini-2.5-flash",
          provider: "gemini",
        };
      },
      reserveUsage: async () => {
        calls.push("usage");
      },
    });

    await service.createChatReply({
      attachments: [
        {
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Checkout requirements",
        },
      ],
      history: [],
      message: "review this",
      mode: "general",
      model: "gemini-2.5-flash",
    });

    assert.deepEqual(calls, ["usage", "ai"]);
  });
});
