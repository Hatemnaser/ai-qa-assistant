import type { NextFunction, Request, Response } from "express";

import { env } from "../../config/env.js";
import { InMemoryFixedWindowRateLimiter } from "../../lib/fixed-window-rate-limiter.js";
import { logAuthRateLimited } from "../../lib/security-events.js";

const RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";

const authMutationLimits = new Map<string, number>([
  ["/forgot-password", env.authForgotPasswordRateLimitMax],
  ["/login", env.authLoginRateLimitMax],
  ["/register", env.authRegisterRateLimitMax],
  ["/resend-verification", env.authResendVerificationRateLimitMax],
  ["/reset-password", env.authResetPasswordRateLimitMax],
  ["/verify-email", env.authVerifyEmailRateLimitMax],
]);

/**
 * Applies route-specific IP throttling before a JSON parser reads the body.
 * This makes malformed and oversized requests consume the same coarse abuse
 * budget as well-formed attempts. Account/email throttling remains post-parse.
 */
export function createAuthPreBodyIpRateLimitMiddleware(
  routeLimits: ReadonlyMap<string, number> = authMutationLimits
) {
  const routeLimiters = new Map(
    [...routeLimits].map(([path, maxAttempts]) => [
      normalizeAuthMutationPath(path),
      new InMemoryFixedWindowRateLimiter({
        maxAttempts,
        windowMs: env.authRateLimitWindowMs,
      }),
    ])
  );

  authRateLimiters.push(...routeLimiters.values());

  return function authPreBodyIpRateLimit(req: Request, res: Response, next: NextFunction) {
    // Express routes are case-insensitive and accept a trailing slash by
    // default. Normalize with the same semantics so an equivalent spelling
    // cannot skip the pre-body limiter while still reaching the route.
    const normalizedPath = normalizeAuthMutationPath(req.path);
    const limiter = req.method === "POST" ? routeLimiters.get(normalizedPath) : undefined;

    if (!limiter) {
      next();
      return;
    }

    const now = Date.now();
    const ipAddress = readIpAddress(req);
    const result = limiter.consume(`ip:${ipAddress}`, now);

    if (!result.limited) {
      next();
      return;
    }

    rejectRateLimited(req, res, {
      closeConnection: true,
      ipAddress,
      now,
      route: `${req.baseUrl}${normalizedPath}`,
      resetAt: result.resetAt,
    });
  };
}

export function createAuthRateLimitMiddleware(maxAttempts: number) {
  const emailLimiter = new InMemoryFixedWindowRateLimiter({
    maxAttempts,
    windowMs: env.authRateLimitWindowMs,
  });

  authRateLimiters.push(emailLimiter);

  return function authRateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const keys = createRateLimitKeys(req);
    const emailResult = keys.emailKey ? emailLimiter.consume(keys.emailKey, now) : undefined;

    if (emailResult?.limited) {
      rejectRateLimited(req, res, {
        email: keys.normalizedEmail,
        ipAddress: keys.ipAddress,
        now,
        resetAt: emailResult.resetAt,
      });
      return;
    }

    next();
  };
}

function createRateLimitKeys(req: Request) {
  const ipAddress = readIpAddress(req);
  const email = normalizeEmail(readEmail(req.body));

  return {
    // Keep the account-oriented limiter independent from IP so rotating
    // addresses cannot bypass throttling for one email address.
    emailKey: email ? `email:${email}` : "",
    ipAddress,
    normalizedEmail: email,
  };
}

function readIpAddress(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown-ip";
}

function rejectRateLimited(
  req: Request,
  res: Response,
  input: {
    closeConnection?: boolean;
    email?: string;
    ipAddress: string;
    now: number;
    route?: string;
    resetAt: number;
  }
) {
  logAuthRateLimited({
    email: input.email,
    ipAddress: input.ipAddress,
    method: req.method,
    route: input.route ?? `${req.baseUrl}${req.path}`,
  });
  if (input.closeConnection) {
    // The pre-body limiter must not drain an unbounded attacker-controlled
    // stream. Close after the small response so unread bytes are never reused.
    req.pause();
    res.shouldKeepAlive = false;
    res.setHeader("Connection", "close");
  }
  res.setHeader(
    "Retry-After",
    Math.max(1, Math.ceil((input.resetAt - input.now) / 1000)).toString()
  );
  res.status(429).json({
    code: "RATE_LIMITED",
    error: RATE_LIMITED_MESSAGE,
    message: RATE_LIMITED_MESSAGE,
  });
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

function normalizeAuthMutationPath(path: string) {
  const normalized = path.toLowerCase().replace(/\/+$/, "");

  return normalized || "/";
}

const authRateLimiters: InMemoryFixedWindowRateLimiter[] = [];

export const authPreBodyIpRateLimit = createAuthPreBodyIpRateLimitMiddleware();
export const authLoginRateLimit = createAuthRateLimitMiddleware(env.authLoginRateLimitMax);
export const authRegisterRateLimit = createAuthRateLimitMiddleware(env.authRegisterRateLimitMax);
export const authForgotPasswordRateLimit = createAuthRateLimitMiddleware(
  env.authForgotPasswordRateLimitMax
);
export const authResetPasswordRateLimit = createAuthRateLimitMiddleware(
  env.authResetPasswordRateLimitMax
);
export const authResendVerificationRateLimit = createAuthRateLimitMiddleware(
  env.authResendVerificationRateLimitMax
);
export const authVerifyEmailRateLimit = createAuthRateLimitMiddleware(
  env.authVerifyEmailRateLimitMax
);

export function resetAuthRateLimitersForTests() {
  for (const limiter of authRateLimiters) {
    limiter.reset();
  }
}
