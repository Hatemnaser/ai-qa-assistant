import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGeminiError } from "../src/modules/ai/gemini.errors.ts";
import {
  logAuthRateLimited,
  logChatRateLimited,
  setSecurityEventLoggerForTests,
  type SecurityEventPayload,
} from "../src/lib/security-events.ts";

describe("security event logging", () => {
  it("hashes auth rate-limit identifiers instead of logging raw email or IP", () => {
    const events = captureSecurityEvents(() => {
      logAuthRateLimited({
        email: " Person@Example.com ",
        ipAddress: "203.0.113.10",
        method: "POST",
        route: "/api/auth/login",
      });
    });
    const event = events[0];
    const serialized = JSON.stringify(event);

    assert.equal(event?.event, "auth_rate_limited");
    assert.equal(event?.code, "RATE_LIMITED");
    assert.equal(event?.method, "POST");
    assert.equal(event?.route, "/api/auth/login");
    assert.match(event?.timestamp || "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof event?.emailHash, "string");
    assert.equal(typeof event?.ipHash, "string");
    assert.equal(serialized.includes("Person@Example.com"), false);
    assert.equal(serialized.includes("person@example.com"), false);
    assert.equal(serialized.includes("203.0.113.10"), false);
  });

  it("hashes guest chat identifiers while keeping signed-in user ids explicit", () => {
    const events = captureSecurityEvents(() => {
      logChatRateLimited({
        guestId: "guest-secret-cookie-value",
        identityType: "guest",
        ipAddress: "198.51.100.20",
      });
      logChatRateLimited({
        identityType: "user",
        ipAddress: "198.51.100.21",
        userId: "user-1",
      });
    });
    const serialized = JSON.stringify(events);

    assert.equal(events[0]?.event, "chat_rate_limited");
    assert.equal(events[0]?.identityType, "guest");
    assert.equal(typeof events[0]?.guestIdHash, "string");
    assert.equal(events[1]?.identityType, "user");
    assert.equal(events[1]?.userId, "user-1");
    assert.equal(serialized.includes("guest-secret-cookie-value"), false);
    assert.equal(serialized.includes("198.51.100.20"), false);
    assert.equal(serialized.includes("198.51.100.21"), false);
  });

  it("logs Gemini quota/model provider errors without prompt content", () => {
    const events = captureSecurityEvents(() => {
      const error = normalizeGeminiError(
        {
          message: JSON.stringify({
            error: {
              code: 429,
              message: "quota exceeded for project",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
        },
        "gemini-2.5-flash",
        {
          operation: "chat",
          provider: "gemini",
        }
      );

      assert.equal((error as { code?: string }).code, "QUOTA_EXCEEDED");
    });
    const event = events[0];
    const serialized = JSON.stringify(event);

    assert.equal(event?.event, "provider_ai_error");
    assert.equal(event?.code, "PROVIDER_AI_ERROR");
    assert.equal(event?.errorCode, "QUOTA_EXCEEDED");
    assert.equal(event?.operation, "chat");
    assert.equal(event?.provider, "gemini");
    assert.equal(serialized.includes("quota exceeded for project"), false);
    assert.equal(serialized.includes("gemini-2.5-flash"), false);
  });
});

function captureSecurityEvents(operation: () => void) {
  const events: SecurityEventPayload[] = [];
  const restore = setSecurityEventLoggerForTests((event) => {
    events.push(event);
  });

  try {
    operation();
  } finally {
    restore();
  }

  return events;
}
