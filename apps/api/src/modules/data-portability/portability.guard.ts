import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";

export const PORTABILITY_RATE_LIMIT_POLICIES = Object.freeze({
  projectExport: { maxAttempts: 6, windowMs: 60 * 60 * 1_000 },
  importPreview: { maxAttempts: 10, windowMs: 60 * 60 * 1_000 },
  importCommit: { maxAttempts: 3, windowMs: 60 * 60 * 1_000 },
});

export const PORTABILITY_CONCURRENCY_POLICY = Object.freeze({
  maxGlobal: 2,
  maxPerUser: 1,
});

interface RateLimitPolicy {
  maxAttempts: number;
  windowMs: number;
}

export function createPortabilityRateLimit(
  operation: string,
  policy: RateLimitPolicy
) {
  const limiter = new InMemoryFixedWindowRateLimiter(policy);

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.authUser?.id;
    if (!userId) {
      next();
      return;
    }

    const now = Date.now();
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown-ip";
    const userResult = limiter.consume(
      `${operation}:user:${userId}`,
      now
    );
    const ipResult = limiter.consume(
      `${operation}:ip:${ipAddress}`,
      now
    );

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
      String(Math.max(1, Math.ceil((resetAt - now) / 1_000)))
    );
    res.status(429).json({
      code: "PORTABILITY_RATE_LIMITED",
      error: "Too many data portability requests. Please try again later.",
      message: "Too many data portability requests. Please try again later.",
    });
  };

  return {
    middleware,
    reset() {
      limiter.reset();
    },
  };
}

export function createPortabilityConcurrencyLimit(
  policy = PORTABILITY_CONCURRENCY_POLICY
) {
  let activeGlobal = 0;
  const activeByUser = new Map<string, number>();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.authUser?.id;
    if (!userId) {
      next();
      return;
    }

    const activeForUser = activeByUser.get(userId) || 0;
    if (
      activeGlobal >= policy.maxGlobal ||
      activeForUser >= policy.maxPerUser
    ) {
      res.setHeader("Retry-After", "5");
      res.status(429).json({
        code: "PORTABILITY_BUSY",
        error: "Another data portability operation is already running. Please try again shortly.",
        message:
          "Another data portability operation is already running. Please try again shortly.",
      });
      return;
    }

    activeGlobal += 1;
    activeByUser.set(userId, activeForUser + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeGlobal = Math.max(0, activeGlobal - 1);
      const remaining = (activeByUser.get(userId) || 1) - 1;
      if (remaining > 0) activeByUser.set(userId, remaining);
      else activeByUser.delete(userId);
    };

    res.once("finish", release);
    res.once("close", release);
    next();
  };

  return {
    middleware,
    reset() {
      activeGlobal = 0;
      activeByUser.clear();
    },
  };
}

export function createPortabilityImportsGate(enabled: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (enabled) {
      next();
      return;
    }

    res.status(503).json({
      code: "PORTABILITY_IMPORTS_DISABLED",
      error: "Data imports are temporarily disabled.",
      message: "Data imports are temporarily disabled.",
    });
  };
}

const projectExportRateLimiter = createPortabilityRateLimit(
  "project-export",
  PORTABILITY_RATE_LIMIT_POLICIES.projectExport
);
const importPreviewRateLimiter = createPortabilityRateLimit(
  "import-preview",
  PORTABILITY_RATE_LIMIT_POLICIES.importPreview
);
const importCommitRateLimiter = createPortabilityRateLimit(
  "import-commit",
  PORTABILITY_RATE_LIMIT_POLICIES.importCommit
);
const portabilityConcurrencyLimiter = createPortabilityConcurrencyLimit();
export const requirePortabilityImportsEnabled = createPortabilityImportsGate(
  env.portabilityImportsEnabled
);

export const projectExportRateLimit = projectExportRateLimiter.middleware;
export const portabilityImportPreviewRateLimit =
  importPreviewRateLimiter.middleware;
export const portabilityImportCommitRateLimit = importCommitRateLimiter.middleware;
export const portabilityConcurrencyLimit =
  portabilityConcurrencyLimiter.middleware;

export function resetPortabilityGuardsForTests() {
  projectExportRateLimiter.reset();
  importPreviewRateLimiter.reset();
  importCommitRateLimiter.reset();
  portabilityConcurrencyLimiter.reset();
}
