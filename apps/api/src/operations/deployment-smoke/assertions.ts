import type { SmokeHttpResult } from "./http-client.js";
import {
  MAX_SMOKE_EMAIL_LENGTH,
  SmokeProbeError,
} from "./types.js";

export function assertSecurityHeaders(response: Response, isHttps: boolean) {
  assertHeaderContains(response, "cache-control", "no-store");
  assertHeaderEquals(response, "referrer-policy", "no-referrer");
  assertHeaderEquals(response, "x-content-type-options", "nosniff");
  assertHeaderEquals(response, "x-frame-options", "DENY");
  assertHeaderContains(response, "content-security-policy", "default-src 'none'");
  assertHeaderContains(response, "permissions-policy", "camera=()");
  if (isHttps) assertHeaderContains(response, "strict-transport-security", "max-age=");

  const requestId = response.headers.get("x-request-id") || "";
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new SmokeProbeError("invalid_response");
  }
}

export function assertRegistrationConfiguration(value: unknown) {
  const record = readRecord(value);
  if (!new Set(["disabled", "invite", "public"]).has(readString(record, "mode", 32))) {
    throw new SmokeProbeError("invalid_response");
  }
  if (record.termsVersion !== null && typeof record.termsVersion !== "string") {
    throw new SmokeProbeError("invalid_response");
  }
  const legalUrls = readRecord(record, "legalUrls");
  for (const locale of ["ar", "de", "en"] as const) {
    const localeUrls = readRecord(legalUrls, locale);
    assertHttpsUrl(readString(localeUrls, "privacy", 2_048));
    assertHttpsUrl(readString(localeUrls, "terms", 2_048));
  }
}

export function assertCsrfResponse(result: SmokeHttpResult, isHttps: boolean) {
  const token = readString(readRecord(result.body), "csrfToken", 512);
  const tokenCookie = result.setCookies.find((header) =>
    (header.split(";", 1)[0] || "").endsWith(`=${token}`)
  );
  if (!tokenCookie || /(?:^|;)\s*httponly(?:;|$)/i.test(tokenCookie)) {
    throw new SmokeProbeError("invalid_response");
  }
  assertCookieSecurity(tokenCookie, isHttps);
  return token;
}

export function assertAuthenticatedLogin(result: SmokeHttpResult, isHttps: boolean) {
  const sessionCookie = result.setCookies.find((header) =>
    /^qa_session=/i.test(header)
  );
  if (!sessionCookie || !/(?:^|;)\s*httponly(?:;|$)/i.test(sessionCookie)) {
    throw new SmokeProbeError("invalid_response");
  }
  assertCookieSecurity(sessionCookie, isHttps);
  assertCurrentUser(result.body);
  readRecord(readRecord(result.body), "session");
}

export function assertCurrentUser(value: unknown) {
  const root = readRecord(value);
  const user = "user" in root ? readRecord(root, "user") : root;
  readString(user, "id", 128);
  readString(user, "email", MAX_SMOKE_EMAIL_LENGTH);
}

export function readProjectId(value: unknown) {
  const project = readRecord(readRecord(value), "project");
  return readString(project, "id", 128);
}

export function assertProjectPresence(
  value: unknown,
  projectId: string,
  expected: boolean
) {
  const projects = readRecord(value).projects;
  if (!Array.isArray(projects)) throw new SmokeProbeError("invalid_response");
  const present = projects.some((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) return false;
    return (project as Record<string, unknown>).id === projectId;
  });
  if (present !== expected) throw new SmokeProbeError("invalid_response");
}

export function assertCorsAllowed(response: Response, webOrigin: string) {
  assertHeaderEquals(response, "access-control-allow-origin", webOrigin);
  assertHeaderEquals(response, "access-control-allow-credentials", "true");
}

export function createRejectedOrigin(webOrigin: string) {
  const origin = new URL(webOrigin);
  const rejectedHost = origin.hostname === "smoke-rejected.invalid"
    ? "alternate-smoke-rejected.invalid"
    : "smoke-rejected.invalid";
  return `${origin.protocol}//${rejectedHost}`;
}

export function assertRecordFields(
  value: unknown,
  fields: Record<string, unknown>
) {
  const record = readRecord(value);
  for (const [key, expected] of Object.entries(fields)) {
    if (record[key] !== expected) throw new SmokeProbeError("invalid_response");
  }
}

function assertCookieSecurity(header: string, isHttps: boolean) {
  if (isHttps && !/(?:^|;)\s*secure(?:;|$)/i.test(header)) {
    throw new SmokeProbeError("invalid_response");
  }
  if (!/(?:^|;)\s*samesite=(?:lax|none|strict)(?:;|$)/i.test(header)) {
    throw new SmokeProbeError("invalid_response");
  }
}

function readRecord(value: unknown, key?: string): Record<string, unknown> {
  const candidate = key === undefined
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new SmokeProbeError("invalid_response");
  }
  return candidate as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, maxLength: number) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new SmokeProbeError("invalid_response");
  }
  return value;
}

function assertHeaderContains(response: Response, name: string, expected: string) {
  if (!(response.headers.get(name) || "").toLowerCase().includes(expected.toLowerCase())) {
    throw new SmokeProbeError("invalid_response");
  }
}

function assertHeaderEquals(response: Response, name: string, expected: string) {
  if ((response.headers.get(name) || "").toLowerCase() !== expected.toLowerCase()) {
    throw new SmokeProbeError("invalid_response");
  }
}

function assertHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeProbeError("invalid_response");
  }
  if (url.protocol !== "https:") throw new SmokeProbeError("invalid_response");
}
