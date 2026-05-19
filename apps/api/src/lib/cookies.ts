import type { Request } from "express";

export function getCookieValue(req: Request, name: string) {
  return parseCookieHeader(req.headers.cookie)[name];
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

    const cookieName = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();

    if (!cookieName) {
      continue;
    }

    cookies[cookieName] = safeDecodeURIComponent(value);
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
