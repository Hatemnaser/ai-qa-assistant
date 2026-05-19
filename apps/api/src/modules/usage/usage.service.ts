import { createHmac } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { usageRepository, type UsageRepository } from "./usage.repository.js";
import { CHAT_MESSAGE_ACTION, type UsageIdentity, type UsageReservation } from "./usage.types.js";

export interface UsageServiceDependencies {
  now?: () => Date;
  repository: UsageRepository;
}

export function createUsageService({ now = () => new Date(), repository }: UsageServiceDependencies) {
  async function reserveChatMessage(identity: UsageIdentity): Promise<UsageReservation> {
    const action = CHAT_MESSAGE_ACTION;
    const isSignedIn = Boolean(identity.userId);
    const limit = isSignedIn ? env.userDailyMessageLimit : env.guestDailyMessageLimit;
    const since = getWindowStart(now());
    const ipHash = identity.ipAddress ? hashIpAddress(identity.ipAddress) : undefined;

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

    if (used >= limit) {
      throw new AppError(getLimitMessage(isSignedIn), 429, "USAGE_LIMIT_REACHED");
    }

    await repository.recordUsage({
      action,
      guestId: isSignedIn ? undefined : identity.guestId,
      ipHash: isSignedIn ? undefined : ipHash,
      units: 1,
      userId: identity.userId,
    });

    return {
      limit,
      remaining: Math.max(limit - used - 1, 0),
      used: used + 1,
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
    reserveChatMessage,
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
    return "Daily message limit reached. Please try again later.";
  }

  return "Daily demo limit reached. Sign in for more messages or try again later.";
}

export const usageService = createUsageService({
  repository: usageRepository,
});
