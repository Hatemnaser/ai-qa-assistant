import { createHash } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";

const RATE_LIMITED_MESSAGE = "Too many integration requests. Please try again later.";

export function createProjectConnectionPreBodyRateLimit(options: {
  ipLimit?: number;
  tokenLimit?: number;
  windowMs?: number;
} = {}) {
  const windowMs = options.windowMs ?? env.qaIntegrationRateLimitWindowMs;
  const ipLimiter = new InMemoryFixedWindowRateLimiter({
    maxAttempts: options.ipLimit ?? env.qaIntegrationIpRateLimitMax,
    windowMs,
  });
  const tokenLimiter = new InMemoryFixedWindowRateLimiter({
    maxAttempts: options.tokenLimit ?? env.qaIntegrationTokenRateLimitMax,
    windowMs,
  });

  return function projectConnectionPreBodyRateLimit(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const now = Date.now();
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown-ip";
    const ipResult = ipLimiter.consume(`ip:${ipAddress}`, now);
    const token = readBearerToken(req.get("authorization"));
    const tokenResult = token
      ? tokenLimiter.consume(`token:${sha256(token)}`, now)
      : undefined;

    if (!ipResult.limited && !tokenResult?.limited) {
      next();
      return;
    }

    const resetAt = Math.max(
      ipResult.limited ? ipResult.resetAt : 0,
      tokenResult?.limited ? tokenResult.resetAt : 0
    );
    req.pause();
    res.shouldKeepAlive = false;
    res.setHeader("Connection", "close");
    res.setHeader("Retry-After", Math.max(1, Math.ceil((resetAt - now) / 1_000)).toString());
    res.status(429).json({
      code: "RATE_LIMITED",
      error: RATE_LIMITED_MESSAGE,
      message: RATE_LIMITED_MESSAGE,
    });
  };
}

export const projectConnectionPreBodyRateLimit = createProjectConnectionPreBodyRateLimit();

function readBearerToken(value: string | undefined) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(value || "");
  return match?.[1];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
