import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import { createChatService } from "../src/modules/chat/chat.service.ts";

describe("chat service", () => {
  it("returns the stable chat response contract", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.equal(input.message, "hello");
        assert.equal(input.mode, "general");
        assert.equal(input.model, "gemini-3.1-flash-lite");
        assert.equal(input.provider, "gemini");
        assert.equal(input.workflow?.intent, "general_qa");

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
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
      model: "gemini-3.1-flash-lite",
      modelRouting: {
        reason: "Workflow intent general_qa uses the configured general model.",
        requestedModel: "gemini-2.5-flash-lite",
        selectedModel: "gemini-3.1-flash-lite",
        source: "policy",
      },
      provider: "gemini",
      workflow: {
        confidence: 0.4,
        effectiveMode: "general",
        intent: "general_qa",
        language: "english",
        shouldAskClarifyingQuestion: false,
        shouldUseArtifactTemplate: false,
        source: "fallback",
      },
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
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      reserveUsage: async (identity, estimate) => {
        calls.push("usage");
        assert.deepEqual(identity, {
          guestId: "guest-1",
          ipAddress: "127.0.0.1",
          userId: undefined,
        });
        assert.equal(estimate.credits > 0, true);
        assert.equal(estimate.model, "gemini-3.1-flash-lite");

        return {
          limit: 3,
          remaining: 2,
          unit: "credits",
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
      unit: "credits",
      used: 1,
    });
  });

  it("keeps usage event internals out of the public chat response", async () => {
    const service = createChatService({
      chatWithAi: async () => ({
        reply: "Hi from test AI",
        model: "gemini-3.1-flash-lite",
        provider: "gemini",
      }),
      reserveUsage: async () => ({
        eventId: "usage-event-1",
        limit: 20,
        remaining: 18,
        reserved: 2,
        unit: "credits",
        used: 2,
      }),
    });

    const response = await service.createChatReply({
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });

    assert.deepEqual(response.usage, {
      limit: 20,
      remaining: 18,
      unit: "credits",
      used: 2,
    });
  });

  it("returns the AI response even when completing usage metadata fails", async () => {
    const service = createChatService({
      chatWithAi: async () => ({
        reply: "Hi from test AI",
        model: "gemini-3.1-flash-lite",
        provider: "gemini",
        usage: {
          inputTokens: 100,
          outputTokens: 100,
          totalTokens: 200,
        },
      }),
      completeUsage: async () => {
        throw new Error("database update failed");
      },
      reserveUsage: async () => ({
        eventId: "usage-event-1",
        limit: 20,
        remaining: 18,
        reserved: 2,
        unit: "credits",
        used: 2,
      }),
    });

    const response = await service.createChatReply({
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
    });

    assert.equal(response.reply, "Hi from test AI");
    assert.deepEqual(response.usage, {
      limit: 20,
      remaining: 18,
      unit: "credits",
      used: 2,
    });
  });

  it("does not call the AI workflow router when usage is rejected", async () => {
    const calls: string[] = [];
    const service = createChatService({
      chatWithAi: async () => {
        calls.push("ai");
        return {
          reply: "should not happen",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      reserveUsage: async () => {
        calls.push("usage");
        throw new AppError("limit", 429, "USAGE_LIMIT_REACHED");
      },
      routeWorkflow: async () => {
        calls.push("router");
        return {
          confidence: 0.95,
          intent: "conversational",
          language: "arabic",
        };
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply({
          history: [],
          message: "شكرا",
          mode: "bug_report",
          model: "gemini-2.5-flash",
        }),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.deepEqual(calls, ["usage"]);
  });

  it("reserves credits for the workflow router before calling it", async () => {
    const calls: string[] = [];
    const service = createChatService({
      chatWithAi: async () => {
        calls.push("ai");
        return {
          reply: "أهلاً!",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      reserveUsage: async (_identity, estimate) => {
        calls.push("usage");
        assert.notEqual(estimate.workflowSource, "ai_router");
        assert.equal(estimate.credits, 3);

        return {
          limit: 20,
          remaining: 17,
          unit: "credits",
          used: 3,
        };
      },
      routeWorkflow: async () => {
        calls.push("router");
        return {
          confidence: 0.95,
          intent: "conversational",
          language: "arabic",
        };
      },
    });

    await service.createChatReply({
      history: [],
      message: "شكرا",
      mode: "bug_report",
      model: "gemini-2.5-flash",
    });

    assert.deepEqual(calls, ["usage", "router", "ai"]);
  });

  it("converts image attachments into the provider image payload", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.equal(input.model, "gemini-2.5-flash");
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
        assert.equal(input.model, "gemini-3.1-flash-lite");
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

  it("uses the workflow router for ambiguous selected-mode follow-ups", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.equal(input.workflow?.intent, "conversational");
        assert.equal(input.workflow?.source, "ai_router");
        assert.equal(input.model, "gemini-3.1-flash-lite");

        return {
          reply: "You are welcome.",
          model: "gemini-2.5-flash",
          provider: "gemini",
          workflow: input.workflow,
        };
      },
      routeWorkflow: async () => ({
        confidence: 0.94,
        intent: "conversational",
        language: "english",
      }),
    });

    const response = await service.createChatReply({
      history: [
        {
          content: "Bug report",
          mode: "bug_report",
          role: "assistant",
        },
      ],
      message: "thaanks",
      mode: "bug_report",
      model: "gemini-2.5-flash",
    });

    assert.equal(response.mode, "general");
    assert.equal(response.workflow.intent, "conversational");
    assert.equal(response.workflow.source, "ai_router");
  });

  it("falls back to the configured model when the selected model is over quota", async () => {
    const calls: string[] = [];
    const service = createChatService({
      chatWithAi: async (input) => {
        calls.push(input.model || "");

        if (input.model === "gemini-2.5-flash") {
          throw new AppError("quota", 429, "QUOTA_EXCEEDED");
        }

        return {
          reply: "Fallback reply",
          model: input.model || "gemini-2.5-flash-lite",
          provider: "gemini",
        };
      },
    });

    const response = await service.createChatReply({
      attachments: [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          data: "abc",
        },
      ],
      history: [],
      message: "review this",
      mode: "general",
      model: "gemini-2.5-flash",
    });

    assert.deepEqual(calls, ["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    assert.equal(response.model, "gemini-2.5-flash-lite");
    assert.equal(response.modelRouting?.source, "fallback");
  });
});
