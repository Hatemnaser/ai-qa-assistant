import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGeminiTextGenerationConfig } from "../src/modules/ai/gemini.provider.ts";
import { RECIPE_ASSESSMENT_JSON_SCHEMA } from "../src/modules/qa-requests/qa-recipe-assessment.schema.ts";

describe("Gemini structured text configuration", () => {
  it("passes the provider-neutral JSON schema to native constrained output without SDK schema conversion", () => {
    const controller = new AbortController();
    const config = buildGeminiTextGenerationConfig({
      prompt: "Review a recipe.",
      systemInstruction: "Return a review object.",
      responseMimeType: "application/json",
      responseJsonSchema: RECIPE_ASSESSMENT_JSON_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 0,
      signal: controller.signal,
    });
    assert.equal(config.responseJsonSchema, RECIPE_ASSESSMENT_JSON_SCHEMA);
    assert.equal(config.responseSchema, undefined);
    assert.equal(config.responseMimeType, "application/json");
    assert.equal(config.abortSignal, controller.signal);
    assert.equal(config.maxOutputTokens, 4096);
    assert.equal(config.temperature, 0);
    assert.equal(config.systemInstruction, "Return a review object.");
  });

  it("keeps callers without an output schema unchanged", () => {
    const config = buildGeminiTextGenerationConfig({ prompt: "Plain text", responseMimeType: "text/plain" });
    assert.equal(config.responseMimeType, "text/plain");
    assert.equal(config.responseJsonSchema, undefined);
    assert.equal(config.responseSchema, undefined);
    assert.equal(config.temperature, 0.2);
  });
});
