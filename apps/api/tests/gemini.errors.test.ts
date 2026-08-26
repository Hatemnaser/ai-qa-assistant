import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGeminiError } from "../src/modules/ai/gemini.errors.ts";

describe("Gemini error normalization", () => {
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
