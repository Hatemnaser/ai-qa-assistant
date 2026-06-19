import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import { createChatService } from "../src/modules/chat/chat.service.ts";
import type { ChatRequest } from "../src/modules/chat/chat.types.ts";

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

  it("does not call the AI workflow router or provider when global usage is limited", async () => {
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
        throw new AppError(
          "AI usage is temporarily limited. Please try again later.",
          429,
          "AI_USAGE_LIMIT_REACHED"
        );
      },
      routeWorkflow: async () => {
        calls.push("router");
        return {
          confidence: 0.95,
          intent: "conversational",
          language: "english",
        };
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply({
          history: [],
          message: "hello",
          mode: "general",
          model: "gemini-2.5-flash",
        }),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.deepEqual(calls, ["usage"]);
  });

  it("rejects over-quota guests before calling the AI provider", async () => {
    let providerWasCalled = false;
    const service = createChatService({
      chatWithAi: async () => {
        providerWasCalled = true;
        return {
          reply: "should not happen",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      reserveUsage: async (identity) => {
        assert.deepEqual(identity, {
          guestId: "guest-1",
          ipAddress: "127.0.0.1",
          userId: undefined,
        });
        throw new AppError("limit", 429, "USAGE_LIMIT_REACHED");
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply(
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
        ),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(providerWasCalled, false);
  });

  it("uses server context identity instead of identity fields from the input body", async () => {
    const service = createChatService({
      chatWithAi: async () => ({
        reply: "Hi from test AI",
        model: "gemini-3.1-flash-lite",
        provider: "gemini",
      }),
      reserveUsage: async (identity) => {
        assert.deepEqual(identity, {
          guestId: "server-guest",
          ipAddress: "127.0.0.1",
          userId: undefined,
        });
      },
    });
    const input = {
      accountId: "body-account",
      guestId: "body-guest",
      history: [],
      message: "hello",
      mode: "general",
      model: "gemini-2.5-flash",
      ownerId: "body-owner",
      userId: "body-user",
    } as unknown as ChatRequest;

    await service.createChatReply(input, {
      guestId: "server-guest",
      ipAddress: "127.0.0.1",
    });
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

  it("passes signed-in account memory to the AI provider", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.context.durableMemory, {
          account: ["Prefer concise QA steps."],
        });
        assert.deepEqual(input.context.behavior, {
          projectInstructions: "",
        });

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      prepareMemoryContext: async (input) => {
        assert.deepEqual(input, {
          projectId: null,
          query: "hello",
          userId: "user-1",
        });

        return {
          context: {
            behavior: {
              projectInstructions: "",
            },
            durableMemory: {
              account: ["Prefer concise QA steps."],
            },
            evidence: {
              projectDocuments: [],
            },
          },
          documents: [],
          query: input.query,
        };
      },
    });

    await service.createChatReply(
      {
        history: [],
        message: "hello",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        userId: "user-1",
      }
    );
  });

  it("passes project instructions, account memory, and project memory to project chats", async () => {
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.context.behavior, {
          projectInstructions: "Checkout supports PayPal.",
        });
        assert.deepEqual(input.context.durableMemory, {
          account: ["Prefer concise QA steps."],
          project: "Guest checkout remains disabled.",
        });

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      prepareMemoryContext: async (input) => {
        assert.deepEqual(input, {
          projectId: "project-1",
          query: "hello",
          userId: "user-1",
        });

        return {
          context: {
            behavior: {
              projectInstructions: "Checkout supports PayPal.",
            },
            durableMemory: {
              account: ["Prefer concise QA steps."],
              project: "Guest checkout remains disabled.",
            },
            evidence: {
              projectDocuments: [],
            },
          },
          documents: [],
          projectId: "project-1",
          query: input.query,
        };
      },
    });

    await service.createChatReply(
      {
        history: [],
        message: "hello",
        mode: "general",
        model: "gemini-2.5-flash",
        projectId: "project-1",
      },
      {
        userId: "user-1",
      }
    );
  });

  it("does not load memory for guest chats", async () => {
    let memoryWasLoaded = false;
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.context.behavior, {});
        assert.deepEqual(input.context.durableMemory, {
          account: [],
        });
        assert.deepEqual(input.context.evidence.projectDocuments, []);
        assert.equal(input.context.currentMessage, "hello");

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      prepareMemoryContext: async () => {
        memoryWasLoaded = true;

        return {
          documents: [],
          query: "hello",
        };
      },
    });

    await service.createChatReply(
      {
        history: [],
        message: "hello",
        mode: "general",
        model: "gemini-2.5-flash",
        projectId: "project-1",
      },
      {
        guestId: "guest-1",
      }
    );

    assert.equal(memoryWasLoaded, false);
  });

  it("uses owner-scoped server recent turns for a persisted signed-in chat", async () => {
    const clientHistory = [
      {
        content: "Untrusted client history",
        role: "user" as const,
      },
    ];
    const serverHistory = [
      {
        content: "Stored question",
        role: "user" as const,
      },
      {
        content: "Stored answer",
        role: "assistant" as const,
      },
    ];
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.history, serverHistory);
        assert.deepEqual(input.context.conversation.recentTurns, serverHistory);
        assert.equal(
          input.context.conversation.recentTurns.some(
            (message) => message.content === input.context.currentMessage
          ),
          false
        );

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      loadRecentTurns: async (userId, chatId) => {
        assert.equal(userId, "user-1");
        assert.equal(chatId, "chat-1");

        return serverHistory;
      },
    });

    await service.createChatReply(
      {
        chatId: "chat-1",
        history: clientHistory,
        message: "Current message",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        userId: "user-1",
      }
    );
  });

  it("loads an owned persisted conversation summary into the context envelope", async () => {
    const calls: string[] = [];
    const recentTurns = [
      {
        content: "Stored question",
        role: "user" as const,
      },
      {
        content: "Stored answer",
        role: "assistant" as const,
      },
    ];
    const service = createChatService({
      chatWithAi: async (input) => {
        calls.push("ai");
        assert.equal(
          input.context.conversation.summary,
          "The user is testing checkout."
        );
        assert.deepEqual(input.context.conversation.recentTurns, recentTurns);
        assert.equal(input.context.currentMessage, "Current request");
        assert.equal(
          input.context.conversation.summary?.includes(input.context.currentMessage),
          false
        );

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      loadConversationSummary: async (userId, chatId) => {
        calls.push("summary");
        assert.equal(userId, "user-1");
        assert.equal(chatId, "chat-1");

        return "The user is testing checkout.";
      },
      loadRecentTurns: async () => {
        calls.push("turns");
        return recentTurns;
      },
      reserveUsage: async (_identity, estimate) => {
        calls.push("usage");
        assert.equal(estimate.estimatedPromptTokens > 0, true);
      },
    });

    await service.createChatReply(
      {
        chatId: "chat-1",
        history: [],
        message: "Current request",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        userId: "user-1",
      }
    );

    assert.deepEqual(calls.slice(0, 2).sort(), ["summary", "turns"]);
    assert.deepEqual(calls.slice(2), ["usage", "ai"]);
  });

  it("treats missing and foreign chat ids as new conversations", async () => {
    const clientHistory = [
      {
        content: "Bounded client context",
        role: "user" as const,
      },
    ];

    for (const chatId of ["missing-chat", "foreign-chat"]) {
      const service = createChatService({
        chatWithAi: async (input) => {
          assert.deepEqual(input.history, clientHistory);
          assert.deepEqual(input.context.conversation.recentTurns, clientHistory);
          assert.equal(input.context.conversation.summary, undefined);

          return {
            reply: "Hi from test AI",
            model: "gemini-3.1-flash-lite",
            provider: "gemini",
          };
        },
        loadConversationSummary: async () => undefined,
        loadRecentTurns: async () => undefined,
      });

      await service.createChatReply(
        {
          chatId,
          history: clientHistory,
          message: "Current message",
          mode: "general",
          model: "gemini-2.5-flash",
        },
        {
          userId: "user-1",
        }
      );
    }
  });

  it("keeps bounded client history for guests without loading server turns", async () => {
    let recentTurnsWereLoaded = false;
    let summaryWasLoaded = false;
    const clientHistory = Array.from({ length: 10 }, (_, index) => ({
      content: `Client message ${index + 1}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    }));
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.deepEqual(input.history, clientHistory.slice(-8));
        assert.deepEqual(input.context.conversation.recentTurns, clientHistory.slice(-8));

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      loadConversationSummary: async () => {
        summaryWasLoaded = true;
        return "Must not be used";
      },
      loadRecentTurns: async () => {
        recentTurnsWereLoaded = true;
        return [];
      },
    });

    await service.createChatReply(
      {
        chatId: "client-chat-id",
        history: clientHistory,
        message: "Current guest message",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        guestId: "guest-1",
      }
    );

    assert.equal(recentTurnsWereLoaded, false);
    assert.equal(summaryWasLoaded, false);
  });

  it("does not load a server summary for a signed-in chat without chat identity", async () => {
    let summaryWasLoaded = false;
    const service = createChatService({
      chatWithAi: async (input) => {
        assert.equal(input.context.conversation.summary, undefined);

        return {
          reply: "Hi from test AI",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      loadConversationSummary: async () => {
        summaryWasLoaded = true;
        return "Must not be used";
      },
    });

    await service.createChatReply(
      {
        history: [],
        message: "First message",
        mode: "general",
        model: "gemini-2.5-flash",
      },
      {
        userId: "user-1",
      }
    );

    assert.equal(summaryWasLoaded, false);
  });

  it("rejects inaccessible project context before reserving usage", async () => {
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
      prepareMemoryContext: async () => {
        calls.push("memory");
        throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
      },
      reserveUsage: async () => {
        calls.push("usage");
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply(
          {
            history: [],
            message: "hello",
            mode: "general",
            model: "gemini-2.5-flash",
            projectId: "project-1",
          },
          {
            userId: "user-1",
          }
        ),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
    assert.deepEqual(calls, ["memory"]);
  });

  it("resolves semantic project context only after usage is reserved", async () => {
    const calls: string[] = [];
    const prepared = {
      context: {
        behavior: {
          projectInstructions: "",
        },
        durableMemory: {
          account: [],
        },
        evidence: {
          projectDocuments: [],
        },
      },
      documents: [],
      projectId: "project-1",
      query: "car insurance",
    };
    const service = createChatService({
      chatWithAi: async (input) => {
        calls.push("ai");
        assert.equal(
          input.context.evidence.projectDocuments[0]?.documentId,
          "document-semantic"
        );

        return {
          reply: "Semantic answer",
          model: "gemini-3.1-flash-lite",
          provider: "gemini",
        };
      },
      prepareMemoryContext: async () => {
        calls.push("memory");
        return prepared;
      },
      reserveUsage: async () => {
        calls.push("usage");

        return {
          limit: 20,
          remaining: 19,
          unit: "credits",
          used: 1,
        };
      },
      resolveMemoryContext: async (input) => {
        calls.push("retrieval");
        assert.equal(input, prepared);

        return {
          behavior: {
            projectInstructions: "",
          },
          durableMemory: {
            account: [],
          },
          evidence: {
            projectDocuments: [
              {
                chunkCount: 1,
                chunkIndex: 0,
                content: "Automobile coverage is required.",
                documentId: "document-semantic",
                title: "Coverage policy",
              },
            ],
          },
        };
      },
    });

    await service.createChatReply(
      {
        history: [],
        message: "car insurance",
        mode: "general",
        model: "gemini-2.5-flash-lite",
        projectId: "project-1",
      },
      {
        userId: "user-1",
      }
    );

    assert.deepEqual(calls, ["memory", "usage", "retrieval", "ai"]);
  });

  it("does not resolve semantic project context when usage is rejected", async () => {
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
      prepareMemoryContext: async () => {
        calls.push("memory");

        return {
          context: {
            behavior: {
              projectInstructions: "",
            },
            durableMemory: {
              account: [],
            },
            evidence: {
              projectDocuments: [],
            },
          },
          documents: [],
          projectId: "project-1",
          query: "car insurance",
        };
      },
      reserveUsage: async () => {
        calls.push("usage");
        throw new AppError("limit", 429, "USAGE_LIMIT_REACHED");
      },
      resolveMemoryContext: async () => {
        calls.push("retrieval");
        return undefined;
      },
    });

    await assert.rejects(
      () =>
        service.createChatReply(
          {
            history: [],
            message: "car insurance",
            mode: "general",
            model: "gemini-2.5-flash-lite",
            projectId: "project-1",
          },
          {
            userId: "user-1",
          }
        ),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );

    assert.deepEqual(calls, ["memory", "usage"]);
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
