import {
  conversationSummaryRepository,
  type ConversationSummaryRecord,
  type ConversationSummaryRepository,
} from "./conversation-summary.repository.js";
import type {
  ConversationSummaryDto,
  SaveConversationSummaryInput,
} from "./conversation-summary.types.js";

export const CONVERSATION_SUMMARY_MAX_CHARS = 3000;
export const CONVERSATION_SUMMARY_MAX_OPEN_QUESTIONS = 12;
export const CONVERSATION_SUMMARY_MAX_OPEN_QUESTION_CHARS = 300;

export interface ConversationSummaryServiceDependencies {
  repository: ConversationSummaryRepository;
}

export function createConversationSummaryService({
  repository,
}: ConversationSummaryServiceDependencies) {
  async function getConversationSummary(
    userId: string,
    chatId: string
  ): Promise<ConversationSummaryDto | null> {
    const record = await repository.findByChatIdAndUserId(chatId, userId);

    return record ? toConversationSummaryDto(record) : null;
  }

  async function loadConversationSummaryContext(
    userId: string,
    chatId: string
  ): Promise<string | undefined> {
    const record = await repository.findByChatIdAndUserId(chatId, userId);
    const summary = record?.summary.trim();

    return summary?.slice(0, CONVERSATION_SUMMARY_MAX_CHARS) || undefined;
  }

  async function saveConversationSummary(
    userId: string,
    chatId: string,
    input: SaveConversationSummaryInput
  ): Promise<ConversationSummaryDto | null> {
    const record = await repository.upsertByChatIdAndUserId({
      chatId,
      openQuestions: normalizeOpenQuestions(input.openQuestions),
      summary: input.summary.trim().slice(0, CONVERSATION_SUMMARY_MAX_CHARS),
      throughMessageId: normalizeOptionalText(input.throughMessageId),
      userId,
    });

    return record ? toConversationSummaryDto(record) : null;
  }

  async function saveGeneratedConversationSummary(
    userId: string,
    chatId: string,
    input: SaveConversationSummaryInput,
    expectedThroughMessageId: string | null
  ): Promise<ConversationSummaryDto | null> {
    const record = await repository.saveGeneratedIfCursorMatches({
      chatId,
      expectedThroughMessageId,
      openQuestions: normalizeOpenQuestions(input.openQuestions),
      summary: input.summary.trim().slice(0, CONVERSATION_SUMMARY_MAX_CHARS),
      throughMessageId: normalizeOptionalText(input.throughMessageId),
      userId,
    });

    return record ? toConversationSummaryDto(record) : null;
  }

  return {
    getConversationSummary,
    loadConversationSummaryContext,
    saveConversationSummary,
    saveGeneratedConversationSummary,
  };
}

export type ConversationSummaryService = ReturnType<
  typeof createConversationSummaryService
>;

function normalizeOpenQuestions(openQuestions: string[] | undefined) {
  return [
    ...new Set(
      (openQuestions || [])
        .map((item) =>
          item
            .trim()
            .slice(0, CONVERSATION_SUMMARY_MAX_OPEN_QUESTION_CHARS)
        )
        .filter(Boolean)
    ),
  ].slice(0, CONVERSATION_SUMMARY_MAX_OPEN_QUESTIONS);
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}

function toConversationSummaryDto(
  record: ConversationSummaryRecord
): ConversationSummaryDto {
  return {
    chatId: record.chatId,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    openQuestions: record.openQuestions,
    summary: record.summary,
    throughMessageId: record.throughMessageId,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const conversationSummaryService = createConversationSummaryService({
  repository: conversationSummaryRepository,
});
