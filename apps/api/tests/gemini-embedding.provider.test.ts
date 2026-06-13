import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGeminiEmbeddingProvider,
  formatGeminiEmbeddingContent,
  type GeminiEmbeddingClient,
} from "../src/modules/ai/embeddings/gemini-embedding.provider.ts";

describe("Gemini embedding provider", () => {
  it("formats asymmetric retrieval documents and queries", () => {
    assert.equal(
      formatGeminiEmbeddingContent({
        content: "How does guest checkout work?",
        purpose: "query",
      }),
      "task: question answering | query: How does guest checkout work?"
    );
    assert.equal(
      formatGeminiEmbeddingContent({
        content: "Guest checkout is disabled.",
        purpose: "document",
        title: " Checkout   rules ",
      }),
      "title: Checkout rules | text: Guest checkout is disabled."
    );
  });

  it("returns a validated embedding vector", async () => {
    const calls: unknown[] = [];
    const provider = createGeminiEmbeddingProvider({
      apiKey: "test-key",
      client: createFakeClient(calls, [0.25, 0.75]),
      dimensions: 2,
      model: "gemini-embedding-2",
      timeoutMs: 100,
    });

    const result = await provider.embed({
      content: "Guest checkout is disabled.",
      purpose: "document",
      title: "Checkout rules",
    });

    assert.deepEqual(result, {
      dimensions: 2,
      model: "gemini-embedding-2",
      provider: "gemini",
      values: [0.25, 0.75],
    });
    assert.equal(provider.dimensions, 2);
    assert.deepEqual(calls, [
      {
        config: {
          outputDimensionality: 2,
        },
        contents: "title: Checkout rules | text: Guest checkout is disabled.",
        model: "gemini-embedding-2",
      },
    ]);
  });

  it("rejects invalid vectors from the provider", async () => {
    const provider = createGeminiEmbeddingProvider({
      apiKey: "test-key",
      client: createFakeClient([], [0.25]),
      dimensions: 2,
      model: "gemini-embedding-2",
      timeoutMs: 100,
    });

    await assert.rejects(
      () =>
        provider.embed({
          content: "Guest checkout is disabled.",
          purpose: "document",
        }),
      {
        code: "INVALID_EMBEDDING_RESPONSE",
        statusCode: 502,
      }
    );
  });
});

function createFakeClient(
  calls: unknown[],
  values: number[]
): GeminiEmbeddingClient {
  return {
    models: {
      async embedContent(input) {
        calls.push(input);

        return {
          embeddings: [
            {
              values,
            },
          ],
        };
      },
    },
  };
}
