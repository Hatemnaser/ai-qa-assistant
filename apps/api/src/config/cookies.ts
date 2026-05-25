import type { CookieOptions } from "express";

import { env } from "./env.js";

export function getBaseCookieOptions(): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  return {
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
    httpOnly: true,
    path: "/",
    sameSite: env.cookieSameSite,
    secure: env.cookieSecure,
  };
}
