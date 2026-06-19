import { createHmac } from "node:crypto";

import { env } from "../config/env.js";

type SecurityEventCode =
  | "AI_USAGE_LIMIT_REACHED"
  | "PROVIDER_AI_ERROR"
  | "RATE_LIMITED"
  | "USAGE_LIMIT_REACHED";

type SecurityEventName =
  | "auth_rate_limited"
  | "chat_rate_limited"
  | "global_ai_limit_reached"
  | "provider_ai_error"
  | "usage_limit_reached";

type ChatIdentityType = "anonymous" | "guest" | "user";

export interface SecurityEventPayload {
  code: SecurityEventCode;
  emailHash?: string;
  errorCode?: string;
  event: SecurityEventName;
  guestIdHash?: string;
  identityType?: ChatIdentityType;
  ipHash?: string;
  method?: string;
  operation?: string;
  provider?: string;
  route?: string;
  scope?: "global" | "guest" | "user";
  timestamp?: string;
  userId?: string;
}

type SecurityEventWriter = (payload: SecurityEventPayload) => void;

let securityEventWriter: SecurityEventWriter = (payload) => {
  console.warn(JSON.stringify(payload));
};

export function logAuthRateLimited(input: {
  email?: string;
  ipAddress?: string;
  method: string;
  route: string;
}) {
  logSecurityEvent({
    code: "RATE_LIMITED",
    emailHash: hashNormalizedEmail(input.email),
    event: "auth_rate_limited",
    ipHash: hashSecurityIdentifier(input.ipAddress, "ip"),
    method: input.method,
    route: input.route,
  });
}

export function logChatRateLimited(input: {
  guestId?: string;
  identityType: ChatIdentityType;
  ipAddress?: string;
  userId?: string;
}) {
  logSecurityEvent({
    code: "RATE_LIMITED",
    event: "chat_rate_limited",
    guestIdHash: hashSecurityIdentifier(input.guestId, "guest"),
    identityType: input.identityType,
    ipHash: hashSecurityIdentifier(input.ipAddress, "ip"),
    operation: "chat",
    userId: input.userId,
  });
}

export function logUsageLimitReached(input: {
  guestId?: string;
  ipHash?: string;
  operation: string;
  scope: "guest" | "user";
  userId?: string;
}) {
  logSecurityEvent({
    code: "USAGE_LIMIT_REACHED",
    event: "usage_limit_reached",
    guestIdHash: hashSecurityIdentifier(input.guestId, "guest"),
    ipHash: input.ipHash,
    operation: input.operation,
    scope: input.scope,
    userId: input.userId,
  });
}

export function logGlobalAiLimitReached(input: {
  operation: string;
  userId?: string;
}) {
  logSecurityEvent({
    code: "AI_USAGE_LIMIT_REACHED",
    event: "global_ai_limit_reached",
    operation: input.operation,
    scope: "global",
    userId: input.userId,
  });
}

export function logProviderAiError(input: {
  errorCode: string;
  operation: string;
  provider: string;
}) {
  logSecurityEvent({
    code: "PROVIDER_AI_ERROR",
    errorCode: input.errorCode,
    event: "provider_ai_error",
    operation: input.operation,
    provider: input.provider,
  });
}

export function hashNormalizedEmail(email: string | undefined) {
  return hashSecurityIdentifier(email?.trim().toLowerCase(), "email");
}

export function hashSecurityIdentifier(value: string | undefined, kind: string) {
  const normalized = value?.trim();

  if (!normalized) return undefined;

  return createHmac("sha256", env.usageIpHashSalt)
    .update(`${kind}:${normalized}`)
    .digest("hex");
}

export function setSecurityEventLoggerForTests(writer: SecurityEventWriter) {
  const previousWriter = securityEventWriter;

  securityEventWriter = writer;

  return () => {
    securityEventWriter = previousWriter;
  };
}

function logSecurityEvent(input: SecurityEventPayload) {
  const payload = omitUndefined({
    ...input,
    timestamp: input.timestamp || new Date().toISOString(),
  });

  securityEventWriter(payload);
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as T;
}
