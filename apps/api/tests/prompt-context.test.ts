import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AiContextEnvelope } from "../src/modules/ai/ai.types.ts";
import { buildAiPromptWithContext } from "../src/modules/ai/prompt-context.ts";

describe("AI prompt context", () => {
  it("serializes context sections in the contract order", () => {
    const prompt = buildAiPromptWithContext(
      createPromptInput({
        behavior: {
          projectInstructions: "Checkout supports PayPal.",
        },
        conversation: {
          recentTurns: [
            {
              content: "We are testing checkout.",
              role: "user",
            },
          ],
          summary: "The user is reviewing checkout risks.",
        },
        currentMessage: "Create edge cases",
        durableMemory: {
          account: ["Prefer concise QA steps."],
          project: "Guest checkout is a high-risk flow.",
        },
        evidence: {
          attachments: [
            {
              type: "file",
              name: "requirements.md",
              mimeType: "text/markdown",
              content: "# Requirements",
            },
          ],
          projectDocuments: [
            {
              chunkCount: 1,
              chunkIndex: 0,
              content: "Guest checkout is disabled.",
              documentId: "document-1",
              title: "Checkout rules",
            },
          ],
        },
      })
    );

    const orderedSections = [
      "Project instructions:",
      "Account memory:",
      "Project memory:",
      "Project documents:",
      "Conversation summary:",
      "Recent conversation context:",
      "Attached file context:",
      "Current user message:",
    ];

    for (let index = 1; index < orderedSections.length; index += 1) {
      assert.ok(
        prompt.indexOf(orderedSections[index - 1]) < prompt.indexOf(orderedSections[index]),
        `${orderedSections[index - 1]} should appear before ${orderedSections[index]}`
      );
    }

    assert.match(
      prompt,
      /Document: Checkout rules\n<<<PROJECT_DOCUMENT_CONTENT\nGuest checkout is disabled\.\nPROJECT_DOCUMENT_CONTENT/
    );
  });

  it("omits empty sections and keeps the current message separate", () => {
    const currentMessage = "Review this exact request";
    const prompt = buildAiPromptWithContext(
      createPromptInput({
        behavior: {},
        conversation: {
          recentTurns: [],
        },
        currentMessage,
        durableMemory: {
          account: [],
        },
        evidence: {
          attachments: [],
          projectDocuments: [],
        },
      })
    );

    assert.doesNotMatch(prompt, /Project instructions:/);
    assert.doesNotMatch(prompt, /Account memory:/);
    assert.doesNotMatch(prompt, /Project memory:/);
    assert.doesNotMatch(prompt, /Project documents:/);
    assert.doesNotMatch(prompt, /Conversation summary:/);
    assert.doesNotMatch(prompt, /Recent conversation context:/);
    assert.doesNotMatch(prompt, /Attached file context:/);
    assert.match(prompt, /Current user message:\nReview this exact request$/);
    assert.equal(prompt.split(currentMessage).length - 1, 1);
  });

  it("keeps behavior, durable memory, and evidence in distinct sections", () => {
    const prompt = buildAiPromptWithContext(
      createPromptInput({
        behavior: {
          projectInstructions: "BEHAVIOR_VALUE",
        },
        conversation: {
          recentTurns: [],
        },
        currentMessage: "CURRENT_VALUE",
        durableMemory: {
          account: ["MEMORY_VALUE"],
        },
        evidence: {
          attachments: [],
          projectDocuments: [
            {
              chunkCount: 1,
              chunkIndex: 0,
              content: "EVIDENCE_VALUE",
              documentId: "document-1",
              title: "Evidence",
            },
          ],
        },
      })
    );

    assert.match(prompt, /Project instructions:\nBEHAVIOR_VALUE/);
    assert.match(prompt, /Account memory:\n- MEMORY_VALUE/);
    assert.match(
      prompt,
      /Project documents:\nDocument: Evidence\n<<<PROJECT_DOCUMENT_CONTENT\nEVIDENCE_VALUE/
    );
    assert.match(prompt, /Current user message:\nCURRENT_VALUE$/);
  });

  it("labels project document chunks when a document is split", () => {
    const prompt = buildAiPromptWithContext(
      createPromptInput({
        behavior: {},
        conversation: {
          recentTurns: [],
        },
        currentMessage: "Review the requirements",
        durableMemory: {
          account: [],
        },
        evidence: {
          attachments: [],
          projectDocuments: [
            {
              chunkCount: 3,
              chunkIndex: 1,
              content: "Second requirements section.",
              documentId: "document-1",
              title: "Checkout rules",
            },
          ],
        },
      })
    );

    assert.match(prompt, /Document: Checkout rules \(chunk 2 of 3\)/);
  });
});

function createPromptInput(context: AiContextEnvelope) {
  return {
    attachments: context.evidence.attachments,
    context,
    history: context.conversation.recentTurns,
    message: context.currentMessage,
    mode: "general",
  };
}
