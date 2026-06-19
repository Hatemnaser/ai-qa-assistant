import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChatRole } from "../src/generated/prisma/enums.ts";
import { AppError } from "../src/lib/errors.ts";
import type { StoredMessageRecord } from "../src/modules/chat-history/chat-history.repository.ts";
import type {
  ConversationSummaryGenerationState,
  ConversationSummaryRecord,
  ConversationSummaryRepository,
  SaveGeneratedConversationSummaryInput,
  UpsertConversationSummaryInput,
} from "../src/modules/conversation-summary/conversation-summary.repository.ts";
import {
  createConversationSummaryRefreshService,
  createConversationSummaryRefreshPlan,
} from "../src/modules/conversation-summary/conversation-summary-refresh.service.ts";
import { createConversationSummaryService } from "../src/modules/conversation-summary/conversation-summary.service.ts";
import type {
  ConversationSummarizer,
  ConversationSummaryGenerationInput,
  ConversationSummaryGenerationResult,
} from "../src/modules/conversation-summary/conversation-summary.types.ts";
import type { ConversationSummaryUsageTracker } from "../src/modules/usage/conversation-summary-usage.service.ts";

const NOW = new Date("2026-06-14T12:00:00.000Z");

describe("conversation summary refresh service", () => {
  it("creates the first summary only after six complete persisted turns", async () => {
    const messages = [
      ...createCompleteTurns(6),
      createMessage("current-user", ChatRole.USER, "Current incomplete message"),
      createMessage("failed-user", ChatRole.USER, "Failed request"),
      createMessage("failed-assistant", ChatRole.ASSISTANT, "Provider error", {
        isError: true,
      }),
    ];
    const context = setupRefreshService({
      messages,
      ownerId: "user-1",
    });

    const result = await context.refresh.requestRefresh("user-1", "chat-1");
    const saved = context.repository.summaries.get("chat-1");

    assert.equal(result, "completed");
    assert.equal(context.summarizer.inputs.length, 1);
    assert.deepEqual(
      context.summarizer.inputs[0]?.turns.map((turn) => turn.userMessageId),
      ["user-1", "user-2"]
    );
    assert.equal(
      JSON.stringify(context.summarizer.inputs[0]).includes(
        "Current incomplete message"
      ),
      false
    );
    assert.equal(
      JSON.stringify(context.summarizer.inputs[0]).includes("Provider error"),
      false
    );
    assert.equal(saved?.throughMessageId, "assistant-2");
    assert.deepEqual(saved?.openQuestions, []);
    assert.equal(context.usage.started, 1);
    assert.equal(context.usage.completed, 1);
  });

  it("skips summaries before the initial threshold and for guest or foreign chats", async () => {
    const context = setupRefreshService({
      messages: createCompleteTurns(5),
      ownerId: "user-1",
    });

    const early = await context.refresh.requestRefresh("user-1", "chat-1");
    const guest = await context.refresh.requestRefresh(undefined, "chat-1");
    const foreign = await context.refresh.requestRefresh("user-2", "chat-1");
    const missing = await context.refresh.requestRefresh("user-1", "missing");

    assert.equal(early, "skipped");
    assert.equal(guest, "skipped");
    assert.equal(foreign, "skipped");
    assert.equal(missing, "skipped");
    assert.equal(context.summarizer.inputs.length, 0);
    assert.equal(context.repository.summaries.size, 0);
  });

  it("refreshes from the cursor after three additional summarizable turns", async () => {
    const existing = createSummaryRecord({
      chatId: "chat-1",
      openQuestions: ["Which browsers?"],
      summary: "Existing summary",
      throughMessageId: "assistant-2",
      userId: "user-1",
    });
    const context = setupRefreshService({
      existingSummary: existing,
      messages: createCompleteTurns(9),
      ownerId: "user-1",
      generated: {
        model: "summary-model",
        openQuestions: ["Which devices?"],
        provider: "test-provider",
        summary: "Updated summary",
      },
    });

    const result = await context.refresh.requestRefresh("user-1", "chat-1");
    const input = context.summarizer.inputs[0];
    const saved = context.repository.summaries.get("chat-1");

    assert.equal(result, "completed");
    assert.equal(input?.existingSummary, "Existing summary");
    assert.deepEqual(input?.existingOpenQuestions, ["Which browsers?"]);
    assert.deepEqual(
      input?.turns.map((turn) => turn.userMessageId),
      ["user-3", "user-4", "user-5"]
    );
    assert.equal(saved?.summary, "Updated summary");
    assert.equal(saved?.throughMessageId, "assistant-5");
    assert.deepEqual(saved?.openQuestions, ["Which devices?"]);
  });

  it("does not reject when summary generation fails", async () => {
    const context = setupRefreshService({
      generateError: new Error("provider unavailable"),
      messages: createCompleteTurns(6),
      ownerId: "user-1",
    });

    const result = await context.refresh.requestRefresh("user-1", "chat-1");

    assert.equal(result, "failed");
    assert.equal(context.repository.summaries.size, 0);
    assert.equal(context.usage.failed, 1);
  });

  it("skips summary generation when the global AI operation guard rejects it", async () => {
    const context = setupRefreshService({
      messages: createCompleteTurns(6),
      ownerId: "user-1",
      usageStartError: new AppError(
        "AI usage is temporarily limited. Please try again later.",
        429,
        "AI_USAGE_LIMIT_REACHED"
      ),
    });

    const result = await context.refresh.requestRefresh("user-1", "chat-1");

    assert.equal(result, "skipped");
    assert.equal(context.summarizer.inputs.length, 0);
    assert.equal(context.repository.summaries.size, 0);
    assert.equal(context.usage.started, 1);
    assert.equal(context.usage.completed, 0);
    assert.equal(context.usage.failed, 0);
  });

  it("drops stale generated results when the stored cursor changes", async () => {
    const existing = createSummaryRecord({
      chatId: "chat-1",
      openQuestions: [],
      summary: "Existing summary",
      throughMessageId: "assistant-2",
      userId: "user-1",
    });
    const context = setupRefreshService({
      existingSummary: existing,
      messages: createCompleteTurns(9),
      ownerId: "user-1",
    });
    context.summarizer.beforeResolve = () => {
      context.repository.summaries.set(
        "chat-1",
        createSummaryRecord({
          chatId: "chat-1",
          openQuestions: [],
          summary: "Newer concurrent summary",
          throughMessageId: "assistant-4",
          userId: "user-1",
        })
      );
    };

    const result = await context.refresh.requestRefresh("user-1", "chat-1");

    assert.equal(result, "stale");
    assert.equal(
      context.repository.summaries.get("chat-1")?.summary,
      "Newer concurrent summary"
    );
  });

  it("deduplicates concurrent refreshes for the same owned chat", async () => {
    let releaseGeneration: (() => void) | undefined;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const context = setupRefreshService({
      generationGate,
      messages: createCompleteTurns(6),
      ownerId: "user-1",
    });

    const firstRefresh = context.refresh.requestRefresh("user-1", "chat-1");
    await waitFor(() => context.summarizer.inputs.length === 1);
    const secondResult = await context.refresh.requestRefresh("user-1", "chat-1");

    assert.equal(secondResult, "in_progress");

    releaseGeneration?.();
    assert.equal(await firstRefresh, "completed");
    assert.equal(context.summarizer.inputs.length, 1);
  });

  it("treats a missing summary cursor as stale instead of re-summarizing history", () => {
    const plan = createConversationSummaryRefreshPlan({
      messages: createCompleteTurns(9),
      summary: createSummaryRecord({
        chatId: "chat-1",
        openQuestions: [],
        summary: "Existing summary",
        throughMessageId: "deleted-message",
        userId: "user-1",
      }),
    });

    assert.equal(plan, "stale");
  });
});

interface FakeConversationSummaryRepository extends ConversationSummaryRepository {
  chatOwners: Map<string, string>;
  messages: Map<string, StoredMessageRecord[]>;
  summaries: Map<string, ConversationSummaryRecord>;
}

interface FakeSummarizer extends ConversationSummarizer {
  beforeResolve?: () => void;
  inputs: ConversationSummaryGenerationInput[];
}

interface FakeUsageTracker extends ConversationSummaryUsageTracker {
  completed: number;
  failed: number;
  started: number;
}

function setupRefreshService(options: {
  existingSummary?: ConversationSummaryRecord;
  generateError?: Error;
  generated?: ConversationSummaryGenerationResult;
  generationGate?: Promise<void>;
  messages: StoredMessageRecord[];
  ownerId: string;
  usageStartError?: Error;
}) {
  const repository = createFakeRepository(options.ownerId, options.messages);

  if (options.existingSummary) {
    repository.summaries.set("chat-1", options.existingSummary);
  }

  const summarizer: FakeSummarizer = {
    inputs: [],
    model: "summary-model",
    provider: "test-provider",

    async generate(input) {
      summarizer.inputs.push(input);
      await options.generationGate;
      summarizer.beforeResolve?.();

      if (options.generateError) throw options.generateError;

      return (
        options.generated || {
          model: summarizer.model,
          provider: summarizer.provider,
          summary: "Generated summary",
        }
      );
    },
  };
  const usage: FakeUsageTracker = {
    completed: 0,
    failed: 0,
    started: 0,

    async complete() {
      usage.completed += 1;
    },

    async fail() {
      usage.failed += 1;
    },

    async start() {
      usage.started += 1;
      if (options.usageStartError) throw options.usageStartError;

      return {
        action: "conversation_summary",
        eventId: `usage-${usage.started}`,
        reserved: 1,
      };
    },
  };
  const service = createConversationSummaryService({
    repository,
  });

  return {
    refresh: createConversationSummaryRefreshService({
      repository,
      service,
      summarizer,
      usage,
    }),
    repository,
    summarizer,
    usage,
  };
}

function createFakeRepository(
  ownerId: string,
  messages: StoredMessageRecord[]
): FakeConversationSummaryRepository {
  const repository: FakeConversationSummaryRepository = {
    chatOwners: new Map([["chat-1", ownerId]]),
    messages: new Map([["chat-1", messages]]),
    summaries: new Map(),

    async findByChatIdAndUserId(chatId, userId) {
      if (repository.chatOwners.get(chatId) !== userId) return null;

      return repository.summaries.get(chatId) || null;
    },

    async findGenerationStateByChatIdAndUserId(chatId, userId) {
      if (repository.chatOwners.get(chatId) !== userId) return null;

      return {
        messages: repository.messages.get(chatId) || [],
        summary: repository.summaries.get(chatId) || null,
      };
    },

    async saveGeneratedIfCursorMatches(input) {
      if (repository.chatOwners.get(input.chatId) !== input.userId) {
        return null;
      }

      const existing = repository.summaries.get(input.chatId);

      if (
        (existing?.throughMessageId || null) !==
        input.expectedThroughMessageId
      ) {
        return null;
      }

      return saveRecord(repository, input, existing);
    },

    async upsertByChatIdAndUserId(input) {
      if (repository.chatOwners.get(input.chatId) !== input.userId) {
        return null;
      }

      return saveRecord(
        repository,
        input,
        repository.summaries.get(input.chatId)
      );
    },
  };

  return repository;
}

function saveRecord(
  repository: FakeConversationSummaryRepository,
  input:
    | SaveGeneratedConversationSummaryInput
    | UpsertConversationSummaryInput,
  existing?: ConversationSummaryRecord
) {
  const record = createSummaryRecord(input, existing);

  repository.summaries.set(input.chatId, record);

  return record;
}

function createSummaryRecord(
  input: UpsertConversationSummaryInput,
  existing?: ConversationSummaryRecord
): ConversationSummaryRecord {
  return {
    chatId: input.chatId,
    createdAt: existing?.createdAt || NOW,
    id: existing?.id || `summary-${input.chatId}`,
    openQuestions: input.openQuestions,
    summary: input.summary,
    throughMessageId: input.throughMessageId,
    updatedAt: NOW,
    userId: input.userId,
  };
}

function createCompleteTurns(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;

    return [
      createMessage(`user-${turn}`, ChatRole.USER, `Question ${turn}`),
      createMessage(
        `assistant-${turn}`,
        ChatRole.ASSISTANT,
        `Answer ${turn}`
      ),
    ];
  }).flat();
}

function createMessage(
  id: string,
  role: (typeof ChatRole)[keyof typeof ChatRole],
  content: string,
  metadata: unknown = null
): StoredMessageRecord {
  return {
    attachment: null,
    content,
    createdAt: NOW,
    id,
    metadata,
    mode: "general",
    model: "gemini-2.5-flash",
    role,
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for test condition.");
}
