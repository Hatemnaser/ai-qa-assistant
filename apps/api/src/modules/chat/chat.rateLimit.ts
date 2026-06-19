import { env } from "../../config/env.js";

export const CHAT_RATE_LIMITED_MESSAGE = "Too many chat requests. Please try again later.";

interface ChatRateLimitContext {
  guestId?: string;
  ipAddress?: string;
  now?: number;
  userId?: string;
}

interface ChatIpRateLimitContext {
  ipAddress?: string;
  now?: number;
}

interface ChatIdentityRateLimitContext {
  guestId?: string;
  now?: number;
  userId?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class InMemoryChatRateLimiter {
  private readonly attempts = new Map<string, RateLimitEntry>();

  constructor(
    private readonly options: {
      maxAttempts: number;
      windowMs: number;
    }
  ) {}

  consume(key: string, now = Date.now()) {
    this.pruneExpired(now);

    const current = this.attempts.get(key);

    if (!current || current.resetAt <= now) {
      this.attempts.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });
      return false;
    }

    current.count += 1;
    return current.count > this.options.maxAttempts;
  }

  reset() {
    this.attempts.clear();
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}

const ipLimiter = new InMemoryChatRateLimiter({
  maxAttempts: env.chatRateLimitMax,
  windowMs: env.chatRateLimitWindowMs,
});
const guestLimiter = new InMemoryChatRateLimiter({
  maxAttempts: env.guestChatRateLimitMax,
  windowMs: env.chatRateLimitWindowMs,
});
const userLimiter = new InMemoryChatRateLimiter({
  maxAttempts: env.chatRateLimitMax,
  windowMs: env.chatRateLimitWindowMs,
});

export function isChatRateLimited(context: ChatRateLimitContext) {
  const now = context.now ?? Date.now();

  return (
    isChatIpRateLimited({
      ipAddress: context.ipAddress,
      now,
    }) ||
    isChatIdentityRateLimited({
      guestId: context.guestId,
      now,
      userId: context.userId,
    })
  );
}

export function isChatIpRateLimited(context: ChatIpRateLimitContext) {
  const now = context.now ?? Date.now();
  const ipKey = `ip:${context.ipAddress || "unknown-ip"}`;

  return ipLimiter.consume(ipKey, now);
}

export function isChatIdentityRateLimited(context: ChatIdentityRateLimitContext) {
  const now = context.now ?? Date.now();
  const isUserLimited = context.userId
    ? userLimiter.consume(`user:${context.userId}`, now)
    : false;
  const isGuestLimited =
    !context.userId && context.guestId
      ? guestLimiter.consume(`guest:${context.guestId}`, now)
      : false;

  return isUserLimited || isGuestLimited;
}

export function resetChatRateLimitersForTests() {
  ipLimiter.reset();
  guestLimiter.reset();
  userLimiter.reset();
}
