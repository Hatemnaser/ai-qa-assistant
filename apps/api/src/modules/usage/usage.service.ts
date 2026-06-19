import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { calculateCreditsFromTokenUsage, type ChatCreditEstimate } from "./credit-policy.js";
import { createUsageInsightsService } from "./usage-insights.js";
import { usageRepository, type UsageRepository } from "./usage.repository.js";
import { getUsageIdentityScope, getUsageWindowStart } from "./usage.scope.js";
import {
  CHAT_MESSAGE_ACTION,
  type UsageIdentity,
  type UsageReservation,
} from "./usage.types.js";

export interface UsageServiceDependencies {
  globalAiUsageGuard?: GlobalAiUsageGuardConfig;
  now?: () => Date;
  repository: UsageRepository;
}

export interface GlobalAiUsageGuardConfig {
  creditLimit: number;
  requestLimit: number;
  windowMs: number;
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

export interface AiOperationReservationInput {
  action: string;
  credits?: number;
  estimatedOutputTokens?: number;
  estimatedPromptTokens?: number;
  estimatedTotalTokens?: number;
  model?: string;
  provider?: string;
  userId?: string;
}

export interface AiOperationCompletionInput {
  creditsUsed?: number;
  outputTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export interface AiOperationFailureInput {
  model?: string;
  provider?: string;
}

export interface AiOperationReservation {
  action: string;
  eventId?: string;
  model?: string;
  provider?: string;
  reserved: number;
}

export interface AiOperationUsageService {
  completeAiOperation(
    reservation: AiOperationReservation | undefined,
    completion?: AiOperationCompletionInput
  ): Promise<void>;
  failAiOperation(
    reservation: AiOperationReservation | undefined,
    failure?: AiOperationFailureInput
  ): Promise<void>;
  reserveAiOperation(input: AiOperationReservationInput): Promise<AiOperationReservation>;
}

export function createUsageService({
  globalAiUsageGuard = getDefaultGlobalAiUsageGuard(),
  now = () => new Date(),
  repository,
}: UsageServiceDependencies) {
  const insightsService = createUsageInsightsService({
    now,
    repository,
  });

  async function reserveChatCredits(
    identity: UsageIdentity,
    estimate: ChatCreditEstimate
  ): Promise<UsageReservation> {
    const currentTime = now();
    const action = CHAT_MESSAGE_ACTION;
    const since = getUsageWindowStart(currentTime);
    const scope = getUsageIdentityScope(identity);
    const requestedCredits = normalizeCredits(estimate.credits);
    const staleReservedCutoff = getStaleReservedCutoff(currentTime);
    await cleanupStaleReservedChatCreditsForScope(scope, staleReservedCutoff);
    const event = {
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
    };
    const reservation = await repository.reserveUsage({
      action,
      event,
      globalGuard: {
        creditLimit: globalAiUsageGuard.creditLimit,
        requestLimit: globalAiUsageGuard.requestLimit,
        since: getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
        staleReservedCutoff,
      },
      guestId: scope.guestId,
      ipHash: scope.ipHash,
      isSignedIn: scope.isSignedIn,
      limit: scope.limit,
      requestedUnits: requestedCredits,
      since,
      userId: scope.userId,
    });

    if (!reservation.accepted) {
      if (reservation.rejectionReason === "global_limit") {
        throw new AppError(
          "AI usage is temporarily limited. Please try again later.",
          429,
          "AI_USAGE_LIMIT_REACHED"
        );
      }

      throw new AppError(getLimitMessage(scope.isSignedIn), 429, "USAGE_LIMIT_REACHED");
    }

    return {
      eventId: reservation.eventId,
      limit: scope.limit,
      remaining: Math.max(scope.limit - reservation.usedAfter, 0),
      reserved: requestedCredits,
      unit: "credits",
      used: reservation.usedAfter,
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

  async function reserveAiOperation(
    input: AiOperationReservationInput
  ): Promise<AiOperationReservation> {
    const currentTime = now();
    const requestedCredits = normalizeCredits(
      input.credits ?? estimateOperationCredits(input)
    );
    const event = {
      action: input.action,
      creditsReserved: requestedCredits,
      estimatedOutputTokens: input.estimatedOutputTokens,
      estimatedPromptTokens: input.estimatedPromptTokens,
      estimatedTotalTokens: getEstimatedTotalTokens(input),
      model: input.model,
      provider: input.provider,
      status: "reserved",
      units: requestedCredits,
      userId: input.userId,
    };
    const reservation = await repository.reserveUsage({
      action: input.action,
      event,
      globalGuard: {
        creditLimit: globalAiUsageGuard.creditLimit,
        requestLimit: globalAiUsageGuard.requestLimit,
        since: getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
        staleReservedCutoff: getStaleReservedCutoff(currentTime),
      },
      isSignedIn: Boolean(input.userId),
      limit: Number.MAX_SAFE_INTEGER,
      requestedUnits: requestedCredits,
      since: getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
      userId: input.userId,
    });

    if (!reservation.accepted) {
      throw new AppError(
        "AI usage is temporarily limited. Please try again later.",
        429,
        "AI_USAGE_LIMIT_REACHED"
      );
    }

    return {
      action: input.action,
      eventId: reservation.eventId,
      model: input.model,
      provider: input.provider,
      reserved: requestedCredits,
    };
  }

  async function completeAiOperation(
    reservation: AiOperationReservation | undefined,
    completion: AiOperationCompletionInput = {}
  ) {
    if (!reservation?.eventId) return;

    const creditsUsed =
      completion.creditsUsed ??
      calculateCreditsFromTokenUsage({
        fallbackCredits: reservation.reserved,
        model: reservation.model,
        outputTokens: completion.outputTokens,
        promptTokens: completion.promptTokens,
        totalTokens: completion.totalTokens,
      });

    await repository.updateUsage({
      creditsUsed,
      id: reservation.eventId,
      model: reservation.model,
      outputTokens: completion.outputTokens,
      promptTokens: completion.promptTokens,
      provider: reservation.provider,
      status: "completed",
      totalTokens: completion.totalTokens,
      units: creditsUsed,
    });
  }

  async function failAiOperation(
    reservation: AiOperationReservation | undefined,
    failure: AiOperationFailureInput = {}
  ) {
    if (!reservation?.eventId) return;

    await repository.updateUsage({
      creditsUsed: 0,
      id: reservation.eventId,
      model: failure.model || reservation.model,
      provider: failure.provider || reservation.provider,
      status: "failed",
      units: 0,
    });
  }

  async function cleanupStaleReservedChatCredits(identity: UsageIdentity) {
    return cleanupStaleReservedChatCreditsForScope(
      getUsageIdentityScope(identity),
      getStaleReservedCutoff(now())
    );
  }

  async function cleanupStaleReservedChatCreditsForScope(
    scope: ReturnType<typeof getUsageIdentityScope>,
    staleReservedCutoff: Date
  ) {
    return repository.cleanupStaleReservedUsage({
      action: CHAT_MESSAGE_ACTION,
      cutoff: staleReservedCutoff,
      guestId: scope.guestId,
      ipHash: scope.ipHash,
      userId: scope.userId,
    });
  }

  return {
    cleanupStaleReservedChatCredits,
    completeAiOperation,
    completeChatCredits,
    failAiOperation,
    failChatCredits,
    getChatCreditInsights: insightsService.getChatCreditInsights,
    reserveAiOperation,
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

function estimateOperationCredits(input: AiOperationReservationInput) {
  const estimatedTotalTokens = getEstimatedTotalTokens(input);

  if (!estimatedTotalTokens) return 1;

  return estimatedTotalTokens / env.usageTokensPerCredit;
}

function getEstimatedTotalTokens(input: AiOperationReservationInput) {
  return (
    input.estimatedTotalTokens ??
    ((input.estimatedPromptTokens || 0) + (input.estimatedOutputTokens || 0) || undefined)
  );
}

export function isAiUsageLimitError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "AI_USAGE_LIMIT_REACHED"
  );
}

function getStaleReservedCutoff(now: Date) {
  return new Date(now.getTime() - env.usageStaleReservedMinutes * 60 * 1000);
}

function getGlobalUsageWindowStart(now: Date, windowMs: number) {
  return new Date(now.getTime() - windowMs);
}

function getDefaultGlobalAiUsageGuard(): GlobalAiUsageGuardConfig {
  return {
    creditLimit: env.aiGlobalCreditLimit,
    requestLimit: env.aiGlobalRequestLimit,
    windowMs: env.aiGlobalUsageWindowMs,
  };
}

export const usageService = createUsageService({
  repository: usageRepository,
});
