import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";

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

const ipLimiter = new InMemoryFixedWindowRateLimiter({
  maxAttempts: env.chatRateLimitMax,
  windowMs: env.chatRateLimitWindowMs,
});
const guestLimiter = new InMemoryFixedWindowRateLimiter({
  maxAttempts: env.guestChatRateLimitMax,
  windowMs: env.chatRateLimitWindowMs,
});
const userLimiter = new InMemoryFixedWindowRateLimiter({
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

  return ipLimiter.consume(ipKey, now).limited;
}

export function isChatIdentityRateLimited(context: ChatIdentityRateLimitContext) {
  const now = context.now ?? Date.now();
  const isUserLimited = context.userId
    ? userLimiter.consume(`user:${context.userId}`, now).limited
    : false;
  const isGuestLimited =
    !context.userId && context.guestId
      ? guestLimiter.consume(`guest:${context.guestId}`, now).limited
      : false;

  return isUserLimited || isGuestLimited;
}

export function resetChatRateLimitersForTests() {
  ipLimiter.reset();
  guestLimiter.reset();
  userLimiter.reset();
}
