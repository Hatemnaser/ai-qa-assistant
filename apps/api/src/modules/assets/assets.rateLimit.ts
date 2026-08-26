import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";

export function createAssetInitiateRateLimit(options: { maxAttempts: number; windowMs: number }) {
  const limiter = new InMemoryFixedWindowRateLimiter(options);

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.authUser?.id;
    if (!userId) {
      next();
      return;
    }

    const now = Date.now();
    const result = limiter.consume(userId, now);

    if (result.limited) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((result.resetAt - now) / 1000)).toString());
      res.status(429).json({
        code: "RATE_LIMITED",
        error: "Too many upload attempts. Please try again later.",
      });
      return;
    }

    next();
  };

  return {
    middleware,
    reset: () => limiter.reset(),
  };
}

const assetInitiateLimiter = createAssetInitiateRateLimit({
  maxAttempts: env.assetInitiateRateLimitMax,
  windowMs: env.assetInitiateRateLimitWindowMs,
});

export const assetInitiateRateLimit = assetInitiateLimiter.middleware;
export const resetAssetInitiateRateLimitForTests = assetInitiateLimiter.reset;
