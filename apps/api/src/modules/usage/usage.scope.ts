import { createHmac } from "node:crypto";

import { env } from "../../config/env.js";
import type { UsageIdentity, UsageRepository } from "./usage.types.js";

export interface UsageIdentityScope {
  guestId?: string;
  ipHash?: string;
  isSignedIn: boolean;
  limit: number;
  userId?: string;
}

export function getUsageIdentityScope(identity: UsageIdentity): UsageIdentityScope {
  const isSignedIn = Boolean(identity.userId);

  return {
    guestId: isSignedIn ? undefined : identity.guestId,
    ipHash: isSignedIn || !identity.ipAddress ? undefined : hashIpAddress(identity.ipAddress),
    isSignedIn,
    limit: isSignedIn ? env.userDailyCredits : env.guestDailyCredits,
    userId: identity.userId,
  };
}

export function getUsageWindowStart(now: Date) {
  return new Date(now.getTime() - env.usageWindowHours * 60 * 60 * 1000);
}

export async function countScopedUsage(
  repository: UsageRepository,
  input: {
    action: string;
    scope: UsageIdentityScope;
    since: Date;
  }
) {
  if (input.scope.isSignedIn) {
    return repository.countUsage({
      action: input.action,
      since: input.since,
      userId: input.scope.userId,
    });
  }

  const counts = await Promise.all([
    input.scope.guestId
      ? repository.countUsage({
          action: input.action,
          guestId: input.scope.guestId,
          since: input.since,
        })
      : 0,
    input.scope.ipHash
      ? repository.countUsage({
          action: input.action,
          ipHash: input.scope.ipHash,
          since: input.since,
        })
      : 0,
  ]);

  return Math.max(...counts);
}

function hashIpAddress(ipAddress: string) {
  return createHmac("sha256", env.usageIpHashSalt).update(ipAddress).digest("hex");
}
