import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BackendApiError } from "../src/api/backendErrors";
import { fetchUsageSummary } from "../src/features/usage/usageApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("usage api", () => {
  it("loads the current identity usage summary", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/usage/summary");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        identityType: "guest",
        limit: 20,
        modelTotals: [],
        recentEvents: [],
        remaining: 17,
        since: "2026-05-19T12:00:00.000Z",
        statusTotals: [],
        unit: "credits",
        used: 3,
        windowHours: 24,
      });
    });

    const summary = await fetchUsageSummary();

    assert.equal(summary.identityType, "guest");
    assert.equal(summary.remaining, 17);
  });

  it("uses backend usage errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({
      code: "DATABASE_SCHEMA_OUT_OF_DATE",
      error: "Database schema is out of date. Run npm migrations against PostgreSQL.",
    }, 500));

    await assert.rejects(
      () => fetchUsageSummary(),
      (error: unknown) => {
        assert.ok(error instanceof BackendApiError);
        assert.equal(error.code, "DATABASE_SCHEMA_OUT_OF_DATE");
        assert.equal(error.status, 500);
        assert.match(error.message, /temporarily unavailable/i);
        assert.doesNotMatch(error.message, /database|schema|npm|PostgreSQL/i);
        return true;
      }
    );
  });
});

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = handler;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
