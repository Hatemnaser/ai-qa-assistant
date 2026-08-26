import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import { ApiAdapterError } from "../src/api/apiAdapterError.ts";
import { fetchUserSettings, updateUserSettings } from "../src/features/settings/settingsApi.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("settings api", () => {
  it("loads the current user's settings", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/settings");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        settings: {
          defaultModel: "gemini-3.1-flash-lite",
          isDefault: true,
          language: "en",
          theme: "light",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      });
    });

    const settings = await fetchUserSettings();

    assert.equal(settings.defaultModel, "gemini-3.1-flash-lite");
  });

  it("saves the current user's settings", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/settings");
      assert.equal(init?.method, "PUT");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        defaultModel: "gemini-2.5-flash",
        language: "de",
        theme: "dark",
      });

      return jsonResponse({
        settings: {
          defaultModel: "gemini-2.5-flash",
          isDefault: false,
          language: "de",
          theme: "dark",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
      });
    });

    const settings = await updateUserSettings({
      defaultModel: "gemini-2.5-flash",
      language: "de",
      theme: "dark",
    });

    assert.equal(settings.language, "de");
  });

  it("uses backend settings errors when requests fail", async () => {
    mockFetch(async () => jsonResponse({ code: "SESSION_REQUIRED", error: "Authentication is required." }, 401));

    await assert.rejects(() => fetchUserSettings(), /Authentication is required/);
  });

  it("returns stable client error data for network failures", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await assert.rejects(
      () => fetchUserSettings(),
      (error: unknown) => {
        assert.ok(error instanceof ApiAdapterError);
        assert.equal(error.code, "NETWORK_UNAVAILABLE");
        assert.equal(error.message, "NETWORK_UNAVAILABLE");
        return true;
      }
    );
  });
});

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = createCsrfAwareFetch(handler);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}
