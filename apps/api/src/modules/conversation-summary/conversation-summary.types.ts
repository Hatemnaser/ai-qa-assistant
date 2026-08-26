import type { StoredMessageRecord } from "../chat-history/chat-history.types.js";

export interface ConversationSummaryDto {
  chatId: string;
  createdAt: string;
  id: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  updatedAt: string;
}

export interface SaveConversationSummaryInput {
  openQuestions?: string[];
  summary: string;
  throughMessageId?: string | null;
}

export interface ConversationSummaryGenerationTurn {
  assistant: string;
  assistantMessageId: string;
  user: string;
  userMessageId: string;
}

export interface ConversationSummaryGenerationInput {
  existingOpenQuestions: string[];
  existingSummary?: string;
  turns: ConversationSummaryGenerationTurn[];
}

export interface ConversationSummaryGenerationResult {
  model: string;
  openQuestions?: string[];
  provider: string;
  summary: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ConversationSummarizer {
  generate(
    input: ConversationSummaryGenerationInput
  ): Promise<ConversationSummaryGenerationResult>;
  model: string;
  provider: string;
}

export interface ConversationSummaryRecord {
  chatId: string;
  createdAt: Date;
  id: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  updatedAt: Date;
  userId: string;
}

export interface UpsertConversationSummaryInput {
  chatId: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  userId: string;
}

export interface ConversationSummaryGenerationState {
  messages: StoredMessageRecord[];
  summary: ConversationSummaryRecord | null;
}

export interface SaveGeneratedConversationSummaryInput
  extends UpsertConversationSummaryInput {
  expectedThroughMessageId: string | null;
}

export interface ConversationSummaryRepository {
  findByChatIdAndUserId(
    chatId: string,
    userId: string
  ): Promise<ConversationSummaryRecord | null>;
  findGenerationStateByChatIdAndUserId(
    chatId: string,
    userId: string
  ): Promise<ConversationSummaryGenerationState | null>;
  saveGeneratedIfCursorMatches(
    input: SaveGeneratedConversationSummaryInput
  ): Promise<ConversationSummaryRecord | null>;
  upsertByChatIdAndUserId(
    input: UpsertConversationSummaryInput
  ): Promise<ConversationSummaryRecord | null>;
}
