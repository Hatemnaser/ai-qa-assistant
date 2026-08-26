import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";
import { logAuthRateLimited } from "../../lib/security-events.js";

const RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";

export function createAccountDeletionRateLimitMiddleware(
  maxAttempts = env.accountDeleteRateLimitMax
) {
  const userLimiter = new InMemoryFixedWindowRateLimiter({
    maxAttempts,
    windowMs: env.authRateLimitWindowMs,
  });
  const ipLimiter = new InMemoryFixedWindowRateLimiter({
    maxAttempts,
    windowMs: env.authRateLimitWindowMs,
  });
  accountDeletionRateLimiters.push(userLimiter, ipLimiter);

  return function accountDeletionRateLimit(req: Request, res: Response, next: NextFunction) {
    const userId = req.authUser?.id;

    if (!userId) {
      next();
      return;
    }

    const now = Date.now();
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown-ip";
    const userResult = userLimiter.consume(`user:${userId}`, now);
    const ipResult = ipLimiter.consume(`ip:${ipAddress}`, now);

    if (!userResult.limited && !ipResult.limited) {
      next();
      return;
    }

    logAuthRateLimited({
      ipAddress,
      method: req.method,
      route: `${req.baseUrl}${req.path}`,
    });
    const resetAt = Math.max(
      userResult.limited ? userResult.resetAt : 0,
      ipResult.limited ? ipResult.resetAt : 0
    );
    res.setHeader("Retry-After", Math.max(1, Math.ceil((resetAt - now) / 1000)).toString());
    res.status(429).json({
      code: "RATE_LIMITED",
      error: RATE_LIMITED_MESSAGE,
      message: RATE_LIMITED_MESSAGE,
    });
  };
}

const accountDeletionRateLimiters: InMemoryFixedWindowRateLimiter[] = [];

export const accountDeletionRateLimit = createAccountDeletionRateLimitMiddleware();

export function resetAccountDeletionRateLimitersForTests() {
  for (const limiter of accountDeletionRateLimiters) {
    limiter.reset();
  }
}
