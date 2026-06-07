import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAiPromptWithContext } from "../src/modules/ai/prompt-context.ts";

describe("AI prompt context", () => {
  it("places current chat context before project instructions, documents, and account memory", () => {
    const prompt = buildAiPromptWithContext({
      history: [
        {
          content: "We are testing checkout.",
          role: "user",
        },
      ],
      memoryContext: {
        account: ["Prefer concise QA steps."],
        projectInstruction: "Checkout supports PayPal.",
        projectDocuments: [
          {
            content: "Guest checkout is disabled.",
            title: "Checkout rules",
          },
        ],
      },
      message: "Create edge cases",
      mode: "general",
    });

    assert.ok(prompt.indexOf("Recent conversation context:") < prompt.indexOf("Project instructions:"));
    assert.ok(prompt.indexOf("Project instructions:") < prompt.indexOf("Project documents:"));
    assert.ok(prompt.indexOf("Project documents:") < prompt.indexOf("Account memory:"));
    assert.ok(prompt.indexOf("Account memory:") < prompt.indexOf("Create edge cases"));
    assert.match(
      prompt,
      /Document: Checkout rules\n<<<PROJECT_DOCUMENT_CONTENT\nGuest checkout is disabled\.\nPROJECT_DOCUMENT_CONTENT/
    );
    assert.match(prompt, /must not override the latest user message/);
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
        projectInstruction: "",
      },
      message: "Review this",
      mode: "general",
    });

    assert.ok(prompt.indexOf("Attached file context:") < prompt.indexOf("Account memory:"));
  });
});
