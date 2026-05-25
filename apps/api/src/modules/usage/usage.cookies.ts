import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";

import { getBaseCookieOptions } from "../../config/cookies.js";
import { getCookieValue } from "../../lib/cookies.js";

export const GUEST_COOKIE_NAME = "qa_guest_id";

const GUEST_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

const guestCookieOptions = {
  ...getBaseCookieOptions(),
  maxAge: GUEST_COOKIE_MAX_AGE_MS,
};

export function getOrCreateGuestId(req: Request, res: Response) {
  const existingGuestId = getCookieValue(req, GUEST_COOKIE_NAME);

  if (existingGuestId && GUEST_ID_PATTERN.test(existingGuestId)) {
    return existingGuestId;
  }

  const guestId = randomBytes(24).toString("base64url");
  res.cookie(GUEST_COOKIE_NAME, guestId, guestCookieOptions);

  return guestId;
}
