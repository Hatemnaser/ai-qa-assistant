import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";

const RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class InMemoryAuthRateLimiter {
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

function createAuthRateLimitMiddleware(maxAttempts: number) {
  const ipLimiter = new InMemoryAuthRateLimiter({
    maxAttempts,
    windowMs: env.authRateLimitWindowMs,
  });
  const emailLimiter = new InMemoryAuthRateLimiter({
    maxAttempts,
    windowMs: env.authRateLimitWindowMs,
  });

  authRateLimiters.push(ipLimiter, emailLimiter);

  return function authRateLimit(req: Request, res: Response, next: NextFunction) {
    const keys = createRateLimitKeys(req);
    const isIpLimited = ipLimiter.consume(keys.ipKey);
    const isEmailLimited = keys.emailKey ? emailLimiter.consume(keys.emailKey) : false;

    if (isIpLimited || isEmailLimited) {
      res.status(429).json({
        code: "RATE_LIMITED",
        error: RATE_LIMITED_MESSAGE,
        message: RATE_LIMITED_MESSAGE,
      });
      return;
    }

    next();
  };
}

function createRateLimitKeys(req: Request) {
  const ipAddress = req.ip || req.socket.remoteAddress || "unknown-ip";
  const email = normalizeEmail(readEmail(req.body));

  return {
    emailKey: email ? `ip-email:${ipAddress}:${email}` : "",
    ipKey: `ip:${ipAddress}`,
  };
}

function readEmail(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>).email;
  return typeof value === "string" ? value : undefined;
}

function normalizeEmail(email: string | undefined) {
  return email?.trim().toLowerCase() || "";
}

const authRateLimiters: InMemoryAuthRateLimiter[] = [];

export const authLoginRateLimit = createAuthRateLimitMiddleware(env.authLoginRateLimitMax);
export const authRegisterRateLimit = createAuthRateLimitMiddleware(env.authRegisterRateLimitMax);
export const authForgotPasswordRateLimit = createAuthRateLimitMiddleware(
  env.authForgotPasswordRateLimitMax
);

export function resetAuthRateLimitersForTests() {
  for (const limiter of authRateLimiters) {
    limiter.reset();
  }
}
