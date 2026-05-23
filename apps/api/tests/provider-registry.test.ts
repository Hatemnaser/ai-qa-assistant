import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FALLBACK_AI_MODEL,
  FALLBACK_AI_PROVIDER,
  getAllowedModelValues,
  getAllowedProviderIds,
  resolveAiModel,
} from "../src/modules/ai/provider-registry.ts";

describe("AI provider registry", () => {
  it("resolves the default provider and model", () => {
    const resolved = resolveAiModel();

    assert.equal(resolved.provider, FALLBACK_AI_PROVIDER);
    assert.equal(resolved.model, FALLBACK_AI_MODEL);
  });

  it("resolves known models to their provider", () => {
    const resolved = resolveAiModel({
      model: "gemini-2.5-flash-lite",
    });

    assert.equal(resolved.provider, "gemini");
    assert.equal(resolved.model, "gemini-2.5-flash-lite");
    assert.equal(resolved.config.supportsImages, true);
  });

  it("rejects unsupported providers", () => {
    assert.throws(
      () =>
        resolveAiModel({
          provider: "unknown-provider",
        }),
      {
        code: "UNSUPPORTED_AI_PROVIDER",
        statusCode: 400,
      }
    );
  });

  it("rejects unsupported models with the current model catalog", () => {
    assert.throws(
      () =>
        resolveAiModel({
          model: "not-a-real-model",
        }),
      {
        code: "UNSUPPORTED_MODEL",
        statusCode: 400,
      }
    );
  });

  it("exposes the allowed provider and model catalogs", () => {
    assert.deepEqual(getAllowedProviderIds(), ["gemini"]);
    assert.ok(getAllowedModelValues().includes("gemini-2.5-flash"));
  });
});
