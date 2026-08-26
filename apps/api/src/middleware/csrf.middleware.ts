import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { getBaseCookieOptions } from "../config/cookies.js";
import { isCorsOriginAllowed } from "../config/cors.js";
import { env } from "../config/env.js";
import { getCookieValue } from "../lib/cookies.js";
import { AppError } from "../lib/errors.js";

const CSRF_TOKEN_BYTES = 32;
const CSRF_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_ERROR_MESSAGE = "CSRF token is invalid or missing.";

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  try {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");

    if (origin && !isCorsOriginAllowed(origin)) {
      throwInvalidCsrfToken();
    }

    const cookieToken = getCookieValue(req, env.csrfCookieName);
    const headerToken = req.get(env.csrfHeaderName);

    if (!cookieToken || !headerToken || cookieToken !== headerToken || !verifyCsrfToken(headerToken)) {
      throwInvalidCsrfToken();
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function issueCsrfToken(req: Request, res: Response) {
  const existingToken = getCookieValue(req, env.csrfCookieName);

  if (existingToken && verifyCsrfToken(existingToken)) {
    return existingToken;
  }

  const token = createCsrfToken();

  res.cookie(env.csrfCookieName, token, {
    ...getBaseCookieOptions(),
    httpOnly: false,
  });

  return token;
}

export function createCsrfToken() {
  const nonce = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
  const signature = signCsrfNonce(nonce);

  return `${nonce}.${signature}`;
}

export function verifyCsrfToken(token: string) {
  const parts = token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const nonce = parts[0];
  const signature = parts[1];

  if (!nonce || !signature || !CSRF_SIGNATURE_PATTERN.test(signature)) {
    return false;
  }

  const expectedSignature = signCsrfNonce(nonce);
  const expected = Buffer.from(expectedSignature, "hex");
  const actual = Buffer.from(signature, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signCsrfNonce(nonce: string) {
  return createHmac("sha256", env.csrfSecret).update(nonce).digest("hex");
}

function throwInvalidCsrfToken(): never {
  throw new AppError(CSRF_ERROR_MESSAGE, 403, "CSRF_TOKEN_INVALID");
}
