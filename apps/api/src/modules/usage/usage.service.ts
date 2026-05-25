import { createHmac } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { calculateCreditsFromTokenUsage, type ChatCreditEstimate } from "./credit-policy.js";
import { usageRepository, type UsageRepository } from "./usage.repository.js";
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
  async function reserveChatCredits(
    identity: UsageIdentity,
    estimate: ChatCreditEstimate
  ): Promise<UsageReservation> {
    const action = CHAT_MESSAGE_ACTION;
    const isSignedIn = Boolean(identity.userId);
    const limit = isSignedIn ? env.userDailyCredits : env.guestDailyCredits;
    const since = getWindowStart(now());
    const ipHash = identity.ipAddress ? hashIpAddress(identity.ipAddress) : undefined;
    const requestedCredits = normalizeCredits(estimate.credits);

    const used = isSignedIn
      ? await repository.countUsage({
          action,
          since,
          userId: identity.userId,
        })
      : await getGuestUsageCount({
          action,
          guestId: identity.guestId,
          ipHash,
          since,
        });

    if (used + requestedCredits > limit) {
      throw new AppError(getLimitMessage(isSignedIn), 429, "USAGE_LIMIT_REACHED");
    }

    const event = await repository.recordUsage({
      action,
      attachmentCount: estimate.attachmentCount,
      creditsReserved: requestedCredits,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      estimatedPromptTokens: estimate.estimatedPromptTokens,
      estimatedTotalTokens: estimate.estimatedTotalTokens,
      fileCount: estimate.fileCount,
      guestId: isSignedIn ? undefined : identity.guestId,
      imageCount: estimate.imageCount,
      ipHash: isSignedIn ? undefined : ipHash,
      mode: estimate.mode,
      model: estimate.model,
      modelRoutingSource: estimate.modelRoutingSource,
      provider: estimate.provider,
      status: "reserved",
      units: requestedCredits,
      userId: identity.userId,
      workflowIntent: estimate.workflowIntent,
      workflowSource: estimate.workflowSource,
    });

    return {
      eventId: event.id,
      limit,
      remaining: Math.max(limit - used - requestedCredits, 0),
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

  async function getGuestUsageCount(input: {
    action: string;
    guestId?: string;
    ipHash?: string;
    since: Date;
  }) {
    const counts = await Promise.all([
      input.guestId
        ? repository.countUsage({
            action: input.action,
            guestId: input.guestId,
            since: input.since,
          })
        : 0,
      input.ipHash
        ? repository.countUsage({
            action: input.action,
            ipHash: input.ipHash,
            since: input.since,
          })
        : 0,
    ]);

    return Math.max(...counts);
  }

  return {
    completeChatCredits,
    failChatCredits,
    reserveChatCredits,
    reserveChatMessage: reserveChatCredits,
  };
}

function getWindowStart(now: Date) {
  return new Date(now.getTime() - env.usageWindowHours * 60 * 60 * 1000);
}

function hashIpAddress(ipAddress: string) {
  return createHmac("sha256", env.usageIpHashSalt).update(ipAddress).digest("hex");
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
