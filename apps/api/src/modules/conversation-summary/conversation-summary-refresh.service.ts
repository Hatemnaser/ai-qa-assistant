import { conversationSummarizer } from "../ai/summarization/conversation-summarizer.js";
import {
  RECENT_COMPLETE_TURN_LIMIT,
  selectCompleteStoredTurns,
  type CompleteStoredTurn,
} from "../chat-history/chat-turns.js";
import {
  conversationSummaryUsageService,
  type ConversationSummaryUsageTracker,
} from "../usage/conversation-summary-usage.service.js";
import {
  conversationSummaryRepository,
  type ConversationSummaryGenerationState,
  type ConversationSummaryRepository,
} from "./conversation-summary.repository.js";
import {
  conversationSummaryService,
  type ConversationSummaryService,
} from "./conversation-summary.service.js";
import type {
  ConversationSummarizer,
  ConversationSummaryGenerationInput,
} from "./conversation-summary.types.js";

export const INITIAL_SUMMARY_COMPLETE_TURN_THRESHOLD = 6;
export const SUMMARY_REFRESH_TURN_THRESHOLD = 3;
export const SUMMARY_REFRESH_CHAR_THRESHOLD = 6000;

export type ConversationSummaryRefreshResult =
  | "completed"
  | "failed"
  | "in_progress"
  | "skipped"
  | "stale";

export interface ConversationSummaryRefreshServiceDependencies {
  repository: ConversationSummaryRepository;
  service: ConversationSummaryService;
  summarizer: ConversationSummarizer;
  usage: ConversationSummaryUsageTracker;
}

export function createConversationSummaryRefreshService({
  repository,
  service,
  summarizer,
  usage,
}: ConversationSummaryRefreshServiceDependencies) {
  const activeRefreshes = new Set<string>();

  async function requestRefresh(
    userId: string | undefined,
    chatId: string | undefined
  ): Promise<ConversationSummaryRefreshResult> {
    if (!userId || !chatId) return "skipped";

    const refreshKey = `${userId}:${chatId}`;

    if (activeRefreshes.has(refreshKey)) return "in_progress";

    activeRefreshes.add(refreshKey);

    try {
      return await refreshOwnedConversation(userId, chatId);
    } catch {
      return "failed";
    } finally {
      activeRefreshes.delete(refreshKey);
    }
  }

  async function refreshOwnedConversation(
    userId: string,
    chatId: string
  ): Promise<ConversationSummaryRefreshResult> {
    const state = await repository.findGenerationStateByChatIdAndUserId(
      chatId,
      userId
    );

    if (!state) return "skipped";

    const plan = createConversationSummaryRefreshPlan(state);

    if (!plan) return "skipped";
    if (plan === "stale") return "stale";

    let usageEventId: string | undefined;

    try {
      usageEventId = await usage.start({
        estimatedPromptTokens: estimateGenerationTokens(plan.input),
        model: summarizer.model,
        provider: summarizer.provider,
        userId,
      });
    } catch {
      usageEventId = undefined;
    }

    let generated;

    try {
      generated = await summarizer.generate(plan.input);
    } catch {
      await ignoreUsageFailure(() => usage.fail(usageEventId));

      return "failed";
    }

    await ignoreUsageFailure(() =>
      usage.complete(usageEventId, generated.usage)
    );

    const saved = await service.saveGeneratedConversationSummary(
      userId,
      chatId,
      {
        openQuestions: generated.openQuestions || [],
        summary: generated.summary,
        throughMessageId: plan.throughMessageId,
      },
      plan.expectedThroughMessageId
    );

    return saved ? "completed" : "stale";
  }

  return {
    requestRefresh,
  };
}

interface ConversationSummaryRefreshPlan {
  expectedThroughMessageId: string | null;
  input: ConversationSummaryGenerationInput;
  throughMessageId: string;
}

export function createConversationSummaryRefreshPlan(
  state: ConversationSummaryGenerationState
): ConversationSummaryRefreshPlan | "stale" | null {
  const completeTurns = selectCompleteStoredTurns(state.messages);
  const summarizableTurns = completeTurns.slice(
    0,
    Math.max(0, completeTurns.length - RECENT_COMPLETE_TURN_LIMIT)
  );

  if (
    !state.summary &&
    completeTurns.length < INITIAL_SUMMARY_COMPLETE_TURN_THRESHOLD
  ) {
    return null;
  }

  const expectedThroughMessageId = state.summary?.throughMessageId || null;
  const pendingTurns = selectPendingTurns(
    summarizableTurns,
    expectedThroughMessageId
  );

  if (pendingTurns === "stale") return "stale";
  if (pendingTurns.length === 0) return null;

  if (
    state.summary &&
    pendingTurns.length < SUMMARY_REFRESH_TURN_THRESHOLD &&
    countTurnCharacters(pendingTurns) < SUMMARY_REFRESH_CHAR_THRESHOLD
  ) {
    return null;
  }

  const lastTurn = pendingTurns.at(-1);

  if (!lastTurn) return null;

  return {
    expectedThroughMessageId,
    input: {
      existingOpenQuestions: state.summary?.openQuestions || [],
      existingSummary: state.summary?.summary,
      turns: pendingTurns.map((turn) => ({
        assistant: turn.assistant.content,
        assistantMessageId: turn.assistant.id,
        user: turn.user.content,
        userMessageId: turn.user.id,
      })),
    },
    throughMessageId: lastTurn.assistant.id,
  };
}

function selectPendingTurns(
  summarizableTurns: CompleteStoredTurn[],
  throughMessageId: string | null
): CompleteStoredTurn[] | "stale" {
  if (!throughMessageId) return summarizableTurns;

  const cursorIndex = summarizableTurns.findIndex(
    (turn) => turn.assistant.id === throughMessageId
  );

  if (cursorIndex === -1) return "stale";

  return summarizableTurns.slice(cursorIndex + 1);
}

function countTurnCharacters(turns: CompleteStoredTurn[]) {
  return turns.reduce(
    (total, turn) =>
      total + turn.user.content.length + turn.assistant.content.length,
    0
  );
}

function estimateGenerationTokens(input: ConversationSummaryGenerationInput) {
  const characters =
    (input.existingSummary?.length || 0) +
    input.existingOpenQuestions.join("\n").length +
    input.turns.reduce(
      (total, turn) => total + turn.user.length + turn.assistant.length,
      0
    );

  return Math.max(1, Math.ceil(characters / 4));
}

async function ignoreUsageFailure(operation: () => Promise<void>) {
  try {
    await operation();
  } catch {
    // Summary usage telemetry must not affect chat persistence.
  }
}

export const conversationSummaryRefreshService =
  createConversationSummaryRefreshService({
    repository: conversationSummaryRepository,
    service: conversationSummaryService,
    summarizer: conversationSummarizer,
    usage: conversationSummaryUsageService,
  });
