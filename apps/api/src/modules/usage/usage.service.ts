import { AppError } from "../../lib/errors.js";
import { calculateCreditsFromTokenUsage, type ChatCreditEstimate } from "./credit-policy.js";
import { createUsageInsightsService } from "./usage-insights.js";
import { usageRepository, type UsageRepository } from "./usage.repository.js";
import { countScopedUsage, getUsageIdentityScope, getUsageWindowStart } from "./usage.scope.js";
import { CHAT_MESSAGE_ACTION, type UsageIdentity, type UsageReservation } from "./usage.types.js";

export interface UsageServiceDependencies {
  now?: () => Date;
  repository: UsageRepository;
}

export interface ChatUsageCompletionInput {
  mode?: string;
  model?: string;
  modelRoutingSource?: string;
  outputTokens?: number;
  promptTokens?: number;
  provider?: string;
  totalTokens?: number;
  workflowIntent?: string;
  workflowSource?: string;
}

export interface ChatUsageFailureInput {
  model?: string;
  provider?: string;
}

export function createUsageService({ now = () => new Date(), repository }: UsageServiceDependencies) {
  const insightsService = createUsageInsightsService({
    now,
    repository,
  });

  async function reserveChatCredits(
    identity: UsageIdentity,
    estimate: ChatCreditEstimate
  ): Promise<UsageReservation> {
    const action = CHAT_MESSAGE_ACTION;
    const since = getUsageWindowStart(now());
    const scope = getUsageIdentityScope(identity);
    const requestedCredits = normalizeCredits(estimate.credits);
    const used = await countScopedUsage(repository, {
      action,
      scope,
      since,
    });

    if (used + requestedCredits > scope.limit) {
      throw new AppError(getLimitMessage(scope.isSignedIn), 429, "USAGE_LIMIT_REACHED");
    }

    const event = await repository.recordUsage({
      action,
      attachmentCount: estimate.attachmentCount,
      creditsReserved: requestedCredits,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      estimatedPromptTokens: estimate.estimatedPromptTokens,
      estimatedTotalTokens: estimate.estimatedTotalTokens,
      fileCount: estimate.fileCount,
      guestId: scope.guestId,
      imageCount: estimate.imageCount,
      ipHash: scope.ipHash,
      mode: estimate.mode,
      model: estimate.model,
      modelRoutingSource: estimate.modelRoutingSource,
      provider: estimate.provider,
      status: "reserved",
      units: requestedCredits,
      userId: scope.userId,
      workflowIntent: estimate.workflowIntent,
      workflowSource: estimate.workflowSource,
    });

    return {
      eventId: event.id,
      limit: scope.limit,
      remaining: Math.max(scope.limit - used - requestedCredits, 0),
      reserved: requestedCredits,
      unit: "credits",
      used: used + requestedCredits,
    };
  }

  async function completeChatCredits(
    reservation: UsageReservation,
    completion: ChatUsageCompletionInput
  ): Promise<UsageReservation> {
    if (!reservation.eventId) return reservation;

    const creditsUsed = calculateCreditsFromTokenUsage({
      fallbackCredits: reservation.reserved,
      model: completion.model,
      outputTokens: completion.outputTokens,
      promptTokens: completion.promptTokens,
      totalTokens: completion.totalTokens,
    });
    const reservedCredits = reservation.reserved || creditsUsed;
    const usageDelta = creditsUsed - reservedCredits;

    await repository.updateUsage({
      creditsUsed,
      id: reservation.eventId,
      mode: completion.mode,
      model: completion.model,
      modelRoutingSource: completion.modelRoutingSource,
      outputTokens: completion.outputTokens,
      promptTokens: completion.promptTokens,
      provider: completion.provider,
      status: "completed",
      totalTokens: completion.totalTokens,
      units: creditsUsed,
      workflowIntent: completion.workflowIntent,
      workflowSource: completion.workflowSource,
    });

    return {
      ...reservation,
      remaining: Math.max(reservation.remaining - usageDelta, 0),
      reserved: creditsUsed,
      used: Math.max(reservation.used + usageDelta, 0),
    };
  }

  async function failChatCredits(
    reservation: UsageReservation,
    failure: ChatUsageFailureInput = {}
  ): Promise<UsageReservation> {
    if (!reservation.eventId) return reservation;

    const reservedCredits = reservation.reserved || 0;

    await repository.updateUsage({
      creditsUsed: 0,
      id: reservation.eventId,
      model: failure.model,
      provider: failure.provider,
      status: "failed",
      units: 0,
    });

    return {
      ...reservation,
      remaining: Math.min(reservation.remaining + reservedCredits, reservation.limit),
      reserved: 0,
      used: Math.max(reservation.used - reservedCredits, 0),
    };
  }

  return {
    completeChatCredits,
    failChatCredits,
    getChatCreditInsights: insightsService.getChatCreditInsights,
    reserveChatCredits,
    reserveChatMessage: reserveChatCredits,
  };
}

function getLimitMessage(isSignedIn: boolean) {
  if (isSignedIn) {
    return "Daily credit limit reached. Please try again later.";
  }

  return "Daily demo credit limit reached. Sign in for more credits or try again later.";
}

function normalizeCredits(credits: number) {
  if (!Number.isFinite(credits)) return 1;

  return Math.max(1, Math.ceil(credits));
}

export const usageService = createUsageService({
  repository: usageRepository,
});
