import {
  usageRepository,
  type UsageRepository,
} from "./usage.repository.js";
import { CONVERSATION_SUMMARY_ACTION } from "./usage.types.js";

export interface ConversationSummaryUsageStartInput {
  estimatedPromptTokens: number;
  model: string;
  provider: string;
  userId: string;
}

export interface ConversationSummaryUsageCompletionInput {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ConversationSummaryUsageTracker {
  complete(
    eventId: string | undefined,
    input?: ConversationSummaryUsageCompletionInput
  ): Promise<void>;
  fail(eventId: string | undefined): Promise<void>;
  start(input: ConversationSummaryUsageStartInput): Promise<string | undefined>;
}

export function createConversationSummaryUsageService(
  repository: UsageRepository
): ConversationSummaryUsageTracker {
  return {
    async complete(eventId, input = {}) {
      if (!eventId) return;

      await repository.updateUsage({
        creditsUsed: 0,
        id: eventId,
        outputTokens: input.outputTokens,
        promptTokens: input.inputTokens,
        status: "completed",
        totalTokens: input.totalTokens,
        units: 0,
      });
    },

    async fail(eventId) {
      if (!eventId) return;

      await repository.updateUsage({
        creditsUsed: 0,
        id: eventId,
        status: "failed",
        units: 0,
      });
    },

    async start(input) {
      const event = await repository.recordUsage({
        action: CONVERSATION_SUMMARY_ACTION,
        creditsReserved: 0,
        estimatedOutputTokens: 750,
        estimatedPromptTokens: input.estimatedPromptTokens,
        estimatedTotalTokens: input.estimatedPromptTokens + 750,
        model: input.model,
        provider: input.provider,
        status: "reserved",
        units: 0,
        userId: input.userId,
      });

      return event.id;
    },
  };
}

export const conversationSummaryUsageService =
  createConversationSummaryUsageService(usageRepository);
