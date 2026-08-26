import { AppError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import {
  logGlobalAiLimitReached,
  logUsageLimitReached,
} from "../../lib/security-events.js";
import { calculateCreditsFromTokenUsage, type ChatCreditEstimate } from "./credit-policy.js";
import { createUsageInsightsService } from "./usage-insights.js";
import { usageRepository } from "./usage.repository.js";
import { getUsageIdentityScope, getUsageWindowStart } from "./usage.scope.js";
import {
  AI_USAGE_ACTIONS,
  CHAT_MESSAGE_ACTION,
  type UsageIdentity,
  type UsageRepository,
  type UsageReservation,
} from "./usage.types.js";

export interface UsageServiceDependencies {
  globalAiUsageGuard?: GlobalAiUsageGuardConfig;
  identityInFlightLimits?: IdentityInFlightLimits;
  now?: () => Date;
  repository: UsageRepository;
}

export interface IdentityInFlightLimits {
  guest: number;
  user: number;
}

export interface GlobalAiUsageGuardConfig {
  creditLimit: number;
  dailyCreditLimit: number;
  dailyRequestLimit: number;
  monthlyCreditLimit: number;
  monthlyRequestLimit: number;
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
  providerAttempted?: boolean;
  providerAttempts?: number;
  routerAttempted?: boolean;
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
  providerAttempted?: boolean;
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
  recordAiOperationAttempt(reservation: { eventId?: string } | undefined): Promise<void>;
  reserveAiOperation(input: AiOperationReservationInput): Promise<AiOperationReservation>;
}

export function createUsageService({
  globalAiUsageGuard = getDefaultGlobalAiUsageGuard(),
  identityInFlightLimits = DEFAULT_IDENTITY_IN_FLIGHT_LIMITS,
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
        additionalWindows: getAdditionalGlobalGuardWindows(currentTime, globalAiUsageGuard),
        creditLimit: globalAiUsageGuard.creditLimit,
        requestLimit: globalAiUsageGuard.requestLimit,
        since: getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
        staleReservedCutoff,
      },
      guestId: scope.guestId,
      ipHash: scope.ipHash,
      isSignedIn: scope.isSignedIn,
      inFlightLimit: getIdentityInFlightLimit(scope.isSignedIn, identityInFlightLimits),
      limit: scope.limit,
      requestedUnits: requestedCredits,
      scopeActions: scope.isSignedIn ? AI_USAGE_ACTIONS : undefined,
      since,
      userId: scope.userId,
    });

    if (!reservation.accepted) {
      if (reservation.rejectionReason === "global_limit") {
        logGlobalAiLimitReached({
          operation: "chat",
          userId: scope.userId,
        });

        throw new AppError(
          "AI usage is temporarily limited. Please try again later.",
          429,
          "AI_USAGE_LIMIT_REACHED"
        );
      }

      if (reservation.rejectionReason === "identity_in_flight") {
        throw new AppError(
          "Too many AI requests are already in progress. Please try again shortly.",
          429,
          "AI_IN_FLIGHT_LIMIT_REACHED"
        );
      }

      logUsageLimitReached({
        guestId: scope.guestId,
        ipHash: scope.ipHash,
        operation: "chat",
        scope: scope.isSignedIn ? "user" : "guest",
        userId: scope.userId,
      });

      throw new AppError(getLimitMessage(scope.isSignedIn), 429, "USAGE_LIMIT_REACHED");
    }

    return {
      eventId: reservation.eventId,
      fixedCredits: estimate.fixedCredits,
      generationAttempts: 0,
      limit: scope.limit,
      providerAttempts: 0,
      remaining: Math.max(scope.limit - reservation.usedAfter, 0),
      reserved: requestedCredits,
      unit: "credits",
      used: reservation.usedAfter,
      routerAttempts: 0,
    };
  }

  async function completeChatCredits(
    reservation: UsageReservation,
    completion: ChatUsageCompletionInput
  ): Promise<UsageReservation> {
    if (!reservation.eventId) return reservation;

    const generationCredits = calculateCreditsFromTokenUsage({
      fallbackCredits: Math.max(
        1,
        (reservation.reserved || 1) - (reservation.fixedCredits || 0)
      ),
      model: completion.model,
      outputTokens: completion.outputTokens,
      promptTokens: completion.promptTokens,
      totalTokens: completion.totalTokens,
    });
    const additionalAttemptCredits = getAdditionalGenerationAttemptCredits(reservation);
    const creditsUsed = normalizeCredits(
      generationCredits + (reservation.fixedCredits || 0) + additionalAttemptCredits
    );
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
      providerAttempts: reservation.providerAttempts,
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
    const providerAttempts = normalizeAttemptCount(
      failure.providerAttempts ??
        Math.max(
          reservation.providerAttempts || 0,
          failure.providerAttempted ? 1 : 0
        )
    );
    const routerAttempts = normalizeAttemptCount(
      Math.max(reservation.routerAttempts || 0, failure.routerAttempted ? 1 : 0)
    );
    const billedAttemptCredits = providerAttempts > 0
      ? getConservativeFailedAttemptCredits(reservation, providerAttempts, routerAttempts)
      : 0;

    await repository.updateUsage({
      creditsUsed: billedAttemptCredits,
      id: reservation.eventId,
      model: failure.model,
      provider: failure.provider,
      providerAttempts,
      status: providerAttempts > 0 ? "unknown" : "failed",
      units: billedAttemptCredits,
    });

    return {
      ...reservation,
      remaining: Math.min(
        reservation.remaining + reservedCredits - billedAttemptCredits,
        reservation.limit
      ),
      reserved: billedAttemptCredits,
      used: Math.max(reservation.used - reservedCredits + billedAttemptCredits, 0),
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
        additionalWindows: getAdditionalGlobalGuardWindows(currentTime, globalAiUsageGuard),
        creditLimit: globalAiUsageGuard.creditLimit,
        requestLimit: globalAiUsageGuard.requestLimit,
        since: getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
        staleReservedCutoff: getStaleReservedCutoff(currentTime),
      },
      isSignedIn: Boolean(input.userId),
      inFlightLimit: getIdentityInFlightLimit(
        Boolean(input.userId),
        identityInFlightLimits
      ),
      limit: input.userId ? env.userDailyCredits : Number.MAX_SAFE_INTEGER,
      requestedUnits: requestedCredits,
      scopeActions: input.userId ? AI_USAGE_ACTIONS : undefined,
      since: input.userId
        ? getUsageWindowStart(currentTime)
        : getGlobalUsageWindowStart(currentTime, globalAiUsageGuard.windowMs),
      userId: input.userId,
    });

    if (!reservation.accepted) {
      if (reservation.rejectionReason === "identity_limit") {
        logUsageLimitReached({
          operation: input.action,
          scope: "user",
          userId: input.userId,
        });

        throw new AppError(getLimitMessage(true), 429, "USAGE_LIMIT_REACHED");
      }

      if (reservation.rejectionReason === "identity_in_flight") {
        throw new AppError(
          "Too many AI requests are already in progress. Please try again shortly.",
          429,
          "AI_IN_FLIGHT_LIMIT_REACHED"
        );
      }

      logGlobalAiLimitReached({
        operation: input.action,
        userId: input.userId,
      });

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
      providerAttempts: 1,
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

    const providerAttempted = Boolean(failure.providerAttempted);
    const creditsUsed = providerAttempted ? reservation.reserved : 0;

    await repository.updateUsage({
      creditsUsed,
      id: reservation.eventId,
      model: failure.model || reservation.model,
      provider: failure.provider || reservation.provider,
      providerAttempts: providerAttempted ? 1 : 0,
      status: providerAttempted ? "unknown" : "failed",
      units: creditsUsed,
    });
  }

  async function recordAiOperationAttempt(
    reservation: { eventId?: string } | undefined
  ) {
    if (!reservation?.eventId) return;

    await repository.recordUsageAttempt(reservation.eventId);
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
    recordAiOperationAttempt,
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

function normalizeAttemptCount(attempts: number) {
  if (!Number.isFinite(attempts)) return 0;

  return Math.max(0, Math.floor(attempts));
}

function getConservativeFailedAttemptCredits(
  reservation: UsageReservation,
  providerAttempts: number,
  routerAttempts: number
) {
  const reservedCredits = reservation.reserved || 1;
  const generationAttempts = Math.max(
    1,
    normalizeAttemptCount(reservation.generationAttempts || providerAttempts - routerAttempts)
  );
  const generationCreditsPerAttempt = Math.max(
    1,
    reservedCredits - (reservation.fixedCredits || 0)
  );

  return Math.max(
    reservedCredits,
    (reservation.fixedCredits || 0) + generationCreditsPerAttempt * generationAttempts
  );
}

function getAdditionalGenerationAttemptCredits(reservation: UsageReservation) {
  const additionalAttempts = Math.max(
    0,
    normalizeAttemptCount(reservation.generationAttempts || 0) - 1
  );
  const estimatedGenerationCredits = Math.max(
    1,
    (reservation.reserved || 1) - (reservation.fixedCredits || 0)
  );

  return additionalAttempts * estimatedGenerationCredits;
}

const DEFAULT_IDENTITY_IN_FLIGHT_LIMITS = Object.freeze({
  guest: 1,
  user: 3,
});

function getIdentityInFlightLimit(
  isSignedIn: boolean,
  limits: IdentityInFlightLimits
) {
  return isSignedIn ? limits.user : limits.guest;
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
  if (!error || typeof error !== "object") return false;

  return new Set([
    "AI_IN_FLIGHT_LIMIT_REACHED",
    "AI_USAGE_LIMIT_REACHED",
    "USAGE_LIMIT_REACHED",
  ]).has(String((error as { code?: unknown }).code || ""));
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
    dailyCreditLimit: env.aiGlobalDailyCreditLimit,
    dailyRequestLimit: env.aiGlobalDailyRequestLimit,
    monthlyCreditLimit: env.aiGlobalMonthlyCreditLimit,
    monthlyRequestLimit: env.aiGlobalMonthlyRequestLimit,
    requestLimit: env.aiGlobalRequestLimit,
    windowMs: env.aiGlobalUsageWindowMs,
  };
}

function getAdditionalGlobalGuardWindows(
  now: Date,
  guard: GlobalAiUsageGuardConfig
) {
  return [
    {
      creditLimit: guard.dailyCreditLimit,
      requestLimit: guard.dailyRequestLimit,
      since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    },
    {
      creditLimit: guard.monthlyCreditLimit,
      requestLimit: guard.monthlyRequestLimit,
      since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    },
  ];
}

export const usageService = createUsageService({
  repository: usageRepository,
});
