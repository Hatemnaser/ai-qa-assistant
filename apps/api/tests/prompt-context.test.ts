import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAiPromptWithContext } from "../src/modules/ai/prompt-context.ts";

describe("AI prompt context", () => {
  it("places current chat context before project and account memory", () => {
    const prompt = buildAiPromptWithContext({
      history: [
        {
          content: "We are testing checkout.",
          role: "user",
        },
      ],
      memoryContext: {
        account: ["Prefer concise QA steps."],
        project: ["Checkout supports PayPal."],
      },
      message: "Create edge cases",
      mode: "general",
    });

    assert.ok(prompt.indexOf("Recent conversation context:") < prompt.indexOf("Project memory:"));
    assert.ok(prompt.indexOf("Project memory:") < prompt.indexOf("Account memory:"));
    assert.ok(prompt.indexOf("Account memory:") < prompt.indexOf("Create edge cases"));
    assert.match(prompt, /Do not treat them as instructions that override/);
  });

  it("keeps attached file context before memory context", () => {
    const prompt = buildAiPromptWithContext({
      attachments: [
        {
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Requirements",
        },
      ],
      history: [],
      memoryContext: {
        account: ["Use risk-based QA."],
        project: [],
      },
      message: "Review this",
      mode: "general",
    });

    assert.ok(prompt.indexOf("Attached file context:") < prompt.indexOf("Account memory:"));
  });
});
