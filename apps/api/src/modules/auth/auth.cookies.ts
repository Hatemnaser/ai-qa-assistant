import type { Request, Response } from "express";

import { env } from "../../config/env.js";

export const AUTH_COOKIE_NAME = "qa_session";

const baseCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: env.nodeEnv === "production",
};

export function setAuthCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions,
    expires: expiresAt,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, baseCookieOptions);
}

export function getAuthCookie(req: Request) {
  return parseCookieHeader(req.headers.cookie)[AUTH_COOKIE_NAME];
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    if (!name) {
      continue;
    }

    cookies[name] = safeDecodeURIComponent(value);
  }

  return cookies;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
