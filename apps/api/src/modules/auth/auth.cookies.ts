import type { Request, Response } from "express";

import { getBaseCookieOptions } from "../../config/cookies.js";
import { getCookieValue } from "../../lib/cookies.js";

export const AUTH_COOKIE_NAME = "qa_session";

const baseCookieOptions = getBaseCookieOptions();

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
  return getCookieValue(req, AUTH_COOKIE_NAME);
}
