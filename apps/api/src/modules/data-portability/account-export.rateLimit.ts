import type { NextFunction, Request, Response } from "express";

import {
  InMemoryFixedWindowRateLimiter,
  type FixedWindowRateLimiterOptions,
} from "../../lib/fixed-window-rate-limiter.js";

export const ACCOUNT_EXPORT_RATE_LIMIT_POLICY = Object.freeze({
  maxAttempts: 3,
  windowMs: 60 * 60 * 1_000,
});

const RATE_LIMITED_MESSAGE =
  "Too many account export requests. Please try again later.";

export function createAccountExportRateLimit(
  options: FixedWindowRateLimiterOptions = ACCOUNT_EXPORT_RATE_LIMIT_POLICY
) {
  const userLimiter = new InMemoryFixedWindowRateLimiter(options);
  const ipLimiter = new InMemoryFixedWindowRateLimiter(options);

  const middleware = (req: Request, res: Response, next: NextFunction) => {
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

    const resetAt = Math.max(
      userResult.limited ? userResult.resetAt : 0,
      ipResult.limited ? ipResult.resetAt : 0
    );
    res.setHeader(
      "Retry-After",
      Math.max(1, Math.ceil((resetAt - now) / 1_000)).toString()
    );
    res.status(429).json({
      code: "ACCOUNT_EXPORT_RATE_LIMITED",
      error: RATE_LIMITED_MESSAGE,
      message: RATE_LIMITED_MESSAGE,
    });
  };

  return {
    middleware,
    reset() {
      userLimiter.reset();
      ipLimiter.reset();
    },
  };
}

const accountExportLimiter = createAccountExportRateLimit();

export const accountExportRateLimit = accountExportLimiter.middleware;
export const resetAccountExportRateLimitForTests = accountExportLimiter.reset;
