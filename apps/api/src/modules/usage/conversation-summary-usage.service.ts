import {
  usageService,
  type AiOperationReservation,
  type AiOperationUsageService,
} from "./usage.service.js";
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
    reservation: AiOperationReservation | undefined,
    input?: ConversationSummaryUsageCompletionInput
  ): Promise<void>;
  fail(
    reservation: AiOperationReservation | undefined,
    providerAttempted?: boolean
  ): Promise<void>;
  recordAttempt(reservation: AiOperationReservation | undefined): Promise<void>;
  start(input: ConversationSummaryUsageStartInput): Promise<AiOperationReservation | undefined>;
}

export function createConversationSummaryUsageService(
  usage: AiOperationUsageService
): ConversationSummaryUsageTracker {
  return {
    async complete(reservation, input = {}) {
      await usage.completeAiOperation(reservation, {
        outputTokens: input.outputTokens,
        promptTokens: input.inputTokens,
        totalTokens: input.totalTokens,
      });
    },

    async fail(reservation, providerAttempted = false) {
      await usage.failAiOperation(reservation, {
        providerAttempted,
      });
    },

    async recordAttempt(reservation) {
      await usage.recordAiOperationAttempt(reservation);
    },

    async start(input) {
      return usage.reserveAiOperation({
        action: CONVERSATION_SUMMARY_ACTION,
        estimatedOutputTokens: 750,
        estimatedPromptTokens: input.estimatedPromptTokens,
        estimatedTotalTokens: input.estimatedPromptTokens + 750,
        model: input.model,
        provider: input.provider,
        userId: input.userId,
      });
    },
  };
}

export const conversationSummaryUsageService =
  createConversationSummaryUsageService(usageService);
