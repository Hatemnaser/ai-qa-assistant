import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSummaryPrompt } from "../src/modules/ai/summarization/gemini-conversation-summarizer.ts";

describe("conversation summarizer prompt", () => {
  it("uses only existing derived state and persisted complete turns", () => {
    const prompt = buildSummaryPrompt({
      existingOpenQuestions: ["Which browsers are required?"],
      existingSummary: "The user is planning checkout coverage.",
      turns: [
        {
          assistant: "We agreed to cover card and wallet payments.",
          assistantMessageId: "assistant-2",
          user: "Include wallet payments too.",
          userMessageId: "user-2",
        },
      ],
    });

    assert.match(prompt, /"existingSummary":/);
    assert.match(prompt, /Which browsers are required\?/);
    assert.match(prompt, /Include wallet payments too\./);
    assert.match(prompt, /persisted complete turns/);
    assert.match(prompt, /Do not add Project Documents, Project Memory/);
    assert.match(prompt, /untrusted conversation content/);
    assert.match(prompt, /CONVERSATION_DATA:/);
  });
});
