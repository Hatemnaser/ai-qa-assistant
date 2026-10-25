import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGeminiError } from "../src/modules/ai/gemini.errors.ts";

describe("Gemini error normalization", () => {
  it("recognizes only a missing selected generateContent model as availability failure", () => {
    const model = "gemini-3.1-flash-lite";
    const message = `models/${model} is not found for API version v1beta, or is not supported for generateContent. prompt=private&key=secret`;
    const normalized = normalizeGeminiError({ message: JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message } }) }, model);
    assert.equal(normalized.code, "MODEL_UNAVAILABLE");
    assert.doesNotMatch(normalized.message, /prompt=|private|key=secret/u);
    for (const input of [
      { code: 404, status: "NOT_FOUND", message: "File is not found" },
      { code: 404, status: "NOT_FOUND", message: "models/other-model is not found" },
      { code: 404, status: "NOT_FOUND", message: `models/other-${model} is not found` },
      { code: 400, status: "INVALID_ARGUMENT", message },
      { code: 403, status: "PERMISSION_DENIED", message },
    ]) {
      assert.notEqual(normalizeGeminiError({ message: JSON.stringify({ error: input }) }, model).code, "MODEL_UNAVAILABLE");
    }
  });

  it("does not expose raw provider messages for rejected requests", () => {
    const secretText = "prompt=private customer data&key=super-secret";
    const error = normalizeGeminiError(
      {
        message: JSON.stringify({
          error: {
            code: 400,
            message: secretText,
            status: "INVALID_ARGUMENT",
          },
        }),
      },
      "gemini-3.1-flash-lite"
    );

    assert.equal(error.code, "AI_PROVIDER_REQUEST_REJECTED");
    assert.equal(error.statusCode, 502);
    assert.doesNotMatch(error.message, /private customer|super-secret|prompt=/i);
  });

  it("wraps unknown SDK errors in a safe public provider error", () => {
    const error = normalizeGeminiError(
      new Error("https://provider.example/internal?token=secret"),
      "gemini-3.1-flash-lite"
    );

    assert.equal(error.code, "AI_PROVIDER_ERROR");
    assert.equal(error.statusCode, 502);
    assert.doesNotMatch(error.message, /provider\.example|token=secret/i);
  });
});
