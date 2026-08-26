import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ConversationSummaryGenerationState,
  ConversationSummaryRecord,
  ConversationSummaryRepository,
  SaveGeneratedConversationSummaryInput,
  UpsertConversationSummaryInput,
} from "../src/modules/conversation-summary/conversation-summary.types.ts";
import {
  CONVERSATION_SUMMARY_MAX_CHARS,
  CONVERSATION_SUMMARY_MAX_OPEN_QUESTION_CHARS,
  CONVERSATION_SUMMARY_MAX_OPEN_QUESTIONS,
  createConversationSummaryService,
} from "../src/modules/conversation-summary/conversation-summary.service.ts";

const NOW = new Date("2026-06-14T10:00:00.000Z");

describe("conversation summary service", () => {
  it("saves and loads one summary for an owned persisted chat", async () => {
    const { repository, service } = setupConversationSummaryService(
      new Map([["chat-1", "user-1"]])
    );

    const created = await service.saveConversationSummary("user-1", "chat-1", {
      openQuestions: ["  Which browsers?  ", "Which browsers?", ""],
      summary: "  The user is testing checkout.  ",
      throughMessageId: " message-8 ",
    });
    const updated = await service.saveConversationSummary("user-1", "chat-1", {
      summary: "Checkout coverage now includes mobile.",
      throughMessageId: "message-10",
    });
    const loaded = await service.getConversationSummary("user-1", "chat-1");

    assert.equal(created?.summary, "The user is testing checkout.");
    assert.deepEqual(created?.openQuestions, ["Which browsers?"]);
    assert.equal(updated?.id, created?.id);
    assert.equal(loaded?.summary, "Checkout coverage now includes mobile.");
    assert.equal(loaded?.throughMessageId, "message-10");
    assert.equal(repository.summaries.size, 1);
  });

  it("treats missing and foreign chats identically", async () => {
    const { repository, service } = setupConversationSummaryService(
      new Map([["chat-1", "user-2"]])
    );

    const foreignRead = await service.getConversationSummary("user-1", "chat-1");
    const missingRead = await service.getConversationSummary("user-1", "missing-chat");
    const foreignWrite = await service.saveConversationSummary("user-1", "chat-1", {
      summary: "Must not be stored",
    });
    const missingWrite = await service.saveConversationSummary(
      "user-1",
      "missing-chat",
      {
        summary: "Must not be stored",
      }
    );

    assert.equal(foreignRead, null);
    assert.equal(missingRead, null);
    assert.equal(foreignWrite, null);
    assert.equal(missingWrite, null);
    assert.equal(repository.summaries.size, 0);
  });

  it("returns only bounded non-empty summary context", async () => {
    const { repository, service } = setupConversationSummaryService(
      new Map([
        ["chat-1", "user-1"],
        ["chat-2", "user-1"],
      ])
    );

    await service.saveConversationSummary("user-1", "chat-1", {
      summary: "x".repeat(CONVERSATION_SUMMARY_MAX_CHARS + 100),
    });
    await service.saveConversationSummary("user-1", "chat-2", {
      summary: "   ",
    });

    const bounded = await service.loadConversationSummaryContext("user-1", "chat-1");
    const empty = await service.loadConversationSummaryContext("user-1", "chat-2");

    assert.equal(bounded?.length, CONVERSATION_SUMMARY_MAX_CHARS);
    assert.equal(empty, undefined);
    assert.equal(repository.summaries.get("chat-1")?.summary.length, CONVERSATION_SUMMARY_MAX_CHARS);
  });

  it("bounds generated open questions defensively", async () => {
    const { service } = setupConversationSummaryService(
      new Map([["chat-1", "user-1"]])
    );

    const saved = await service.saveConversationSummary("user-1", "chat-1", {
      openQuestions: Array.from(
        { length: CONVERSATION_SUMMARY_MAX_OPEN_QUESTIONS + 3 },
        (_, index) => `Question ${index} ${"x".repeat(400)}`
      ),
      summary: "Bounded summary",
    });

    assert.equal(
      saved?.openQuestions.length,
      CONVERSATION_SUMMARY_MAX_OPEN_QUESTIONS
    );
    assert.equal(
      saved?.openQuestions.every(
        (question) =>
          question.length <= CONVERSATION_SUMMARY_MAX_OPEN_QUESTION_CHARS
      ),
      true
    );
  });
});

interface FakeConversationSummaryRepository extends ConversationSummaryRepository {
  chatOwners: Map<string, string>;
  messages: Map<string, ConversationSummaryGenerationState["messages"]>;
  summaries: Map<string, ConversationSummaryRecord>;
}

function setupConversationSummaryService(chatOwners: Map<string, string>) {
  const repository = createFakeConversationSummaryRepository(chatOwners);

  return {
    repository,
    service: createConversationSummaryService({
      repository,
    }),
  };
}

function createFakeConversationSummaryRepository(
  chatOwners: Map<string, string>
): FakeConversationSummaryRepository {
  const repository: FakeConversationSummaryRepository = {
    chatOwners,
    messages: new Map(),
    summaries: new Map(),

    async findByChatIdAndUserId(chatId, userId) {
      const summary = repository.summaries.get(chatId);

      return summary?.userId === userId ? summary : null;
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

      return saveSummary(repository, input, existing);
    },

    async upsertByChatIdAndUserId(input) {
      if (repository.chatOwners.get(input.chatId) !== input.userId) {
        return null;
      }

      const existing = repository.summaries.get(input.chatId);
      return saveSummary(repository, input, existing);
    },
  };

  return repository;
}

function saveSummary(
  repository: FakeConversationSummaryRepository,
  input:
    | UpsertConversationSummaryInput
    | SaveGeneratedConversationSummaryInput,
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
