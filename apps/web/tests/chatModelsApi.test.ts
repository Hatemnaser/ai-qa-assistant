import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fetchAiModelCatalog } from "../src/features/chat/chatModelsApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("chat models api", () => {
  it("loads the model catalog from the backend", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/ai/models");
      assert.equal(init?.credentials, "include");

      return jsonResponse({
        defaultModel: "gemini-2.5-flash",
        defaultProvider: "gemini",
        models: [
          {
            capabilities: {
              images: true,
              text: true,
              textAttachments: true,
            },
            label: "Gemini 2.5 Flash",
            provider: "gemini",
            recommendedFor: "Visual review",
            value: "gemini-2.5-flash",
          },
        ],
        providers: ["gemini"],
      });
    });

    const models = await fetchAiModelCatalog();

    assert.equal(models.length, 1);
    assert.equal(models[0]?.value, "gemini-2.5-flash");
    assert.equal(models[0]?.capabilities.images, true);
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
