import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrompt } from "../src/modules/ai/prompt-templates.ts";
import { analyzeQaWorkflow, type QaWorkflowIntent } from "../src/modules/ai/qa-workflow.ts";

const artifactHeadings = [
  "# Test Cases",
  "# Bug Report",
  "# Edge Case Analysis",
  "# QA Checklist",
  "# Visual QA Review",
];

describe("AI behavior contract", () => {
  const artifactCases: Array<{
    expectedHeading: string;
    expectedIntent: QaWorkflowIntent;
    hasImage?: boolean;
    hasTextAttachment?: boolean;
    message: string;
    mode: string;
    name: string;
  }> = [
    {
      expectedHeading: "# Test Cases",
      expectedIntent: "test_cases",
      message: "create test cases for a checkout page",
      mode: "general",
      name: "test case request from general mode",
    },
    {
      expectedHeading: "# Bug Report",
      expectedIntent: "bug_report",
      message: "write a bug report for a login button that does not work",
      mode: "general",
      name: "bug report request from general mode",
    },
    {
      expectedHeading: "# Edge Case Analysis",
      expectedIntent: "edge_cases",
      message: "suggest edge cases for password reset",
      mode: "general",
      name: "edge case request from general mode",
    },
    {
      expectedHeading: "# QA Checklist",
      expectedIntent: "checklist",
      message: "create a QA checklist for user registration",
      mode: "general",
      name: "checklist request from general mode",
    },
    {
      expectedHeading: "# Visual QA Review",
      expectedIntent: "screenshot_review",
      hasImage: true,
      message: "what should I test here?",
      mode: "general",
      name: "visual review request from attachment",
    },
    {
      expectedHeading: "# Test Cases",
      expectedIntent: "test_cases",
      hasImage: true,
      message: "create test cases from this screen",
      mode: "general",
      name: "test cases from an attached visual",
    },
  ];

  for (const testCase of artifactCases) {
    it(`creates the right QA artifact for ${testCase.name}`, () => {
      const analysis = analyzeQaWorkflow({
        hasImage: testCase.hasImage,
        hasTextAttachment: testCase.hasTextAttachment,
        message: testCase.message,
        mode: testCase.mode,
      });
      const prompt = buildPrompt(testCase.mode, testCase.message, {
        hasImage: testCase.hasImage,
        hasTextAttachment: testCase.hasTextAttachment,
      });

      assert.equal(analysis.intent, testCase.expectedIntent);
      assert.equal(analysis.shouldUseArtifactTemplate, true);
      assert.match(prompt, textPattern(testCase.expectedHeading));
    });
  }

  const conversationalCases: Array<{
    expectedIntent: QaWorkflowIntent;
    message: string;
    mode: string;
    name: string;
  }> = [
    {
      expectedIntent: "conversational",
      message: "thanks",
      mode: "checklist",
      name: "thanks after an artifact",
    },
    {
      expectedIntent: "language_preference",
      message: "can you speak arabic",
      mode: "bug_report",
      name: "language change after an artifact",
    },
    {
      expectedIntent: "clarification",
      message: "can you explain this?",
      mode: "test_cases",
      name: "clarification question after an artifact",
    },
    {
      expectedIntent: "conversational",
      message: "waw",
      mode: "screenshot_review",
      name: "brief reaction after visual review mode",
    },
    {
      expectedIntent: "conversational",
      message: "thanks",
      mode: "screenshot_review",
      name: "thanks after visual review mode",
    },
  ];

  for (const testCase of conversationalCases) {
    it(`keeps ${testCase.name} conversational`, () => {
      const analysis = analyzeQaWorkflow({
        message: testCase.message,
        mode: testCase.mode,
      });
      const prompt = buildPrompt(testCase.mode, testCase.message);

      assert.equal(analysis.intent, testCase.expectedIntent);
      assert.equal(analysis.effectiveMode, "general");
      assert.equal(analysis.shouldUseArtifactTemplate, false);

      for (const heading of artifactHeadings) {
        assert.doesNotMatch(prompt, textPattern(heading));
      }
    });
  }

  const attachmentContextCases: Array<{
    expectedPromptPattern: RegExp;
    expectedIntent: QaWorkflowIntent;
    hasImage?: boolean;
    hasTextAttachment?: boolean;
    message: string;
    mode: string;
    name: string;
  }> = [
    {
      expectedPromptPattern: /Briefly describe what appears to be visible/i,
      expectedIntent: "visual_context",
      hasImage: true,
      message: "waw",
      mode: "general",
      name: "new image with a brief reaction",
    },
    {
      expectedPromptPattern: /Briefly describe what appears to be visible/i,
      expectedIntent: "visual_context",
      hasImage: true,
      message: "can you explain this?",
      mode: "general",
      name: "new image with a clarification question",
    },
    {
      expectedPromptPattern: /attached text or data files/i,
      expectedIntent: "file_context",
      hasTextAttachment: true,
      message: "thanks",
      mode: "general",
      name: "new text file with a brief reaction",
    },
    {
      expectedPromptPattern: /attached text or data files/i,
      expectedIntent: "file_context",
      hasTextAttachment: true,
      message: "can you explain this?",
      mode: "general",
      name: "new text file with a clarification question",
    },
  ];

  for (const testCase of attachmentContextCases) {
    it(`uses attachment context for ${testCase.name}`, () => {
      const analysis = analyzeQaWorkflow({
        hasImage: testCase.hasImage,
        hasTextAttachment: testCase.hasTextAttachment,
        message: testCase.message,
        mode: testCase.mode,
      });
      const prompt = buildPrompt(testCase.mode, testCase.message, {
        hasImage: testCase.hasImage,
        hasTextAttachment: testCase.hasTextAttachment,
      });

      assert.equal(analysis.intent, testCase.expectedIntent);
      assert.equal(analysis.effectiveMode, "general");
      assert.equal(analysis.shouldUseArtifactTemplate, false);
      assert.match(prompt, testCase.expectedPromptPattern);

      for (const heading of artifactHeadings) {
        assert.doesNotMatch(prompt, textPattern(heading));
      }
    });
  }

  it("asks focused questions for underspecified artifact requests", () => {
    const analysis = analyzeQaWorkflow({
      message: "login",
      mode: "test_cases",
    });
    const prompt = buildPrompt("test_cases", "login");

    assert.equal(analysis.shouldAskClarifyingQuestion, true);
    assert.match(prompt, /underspecified/i);
    assert.match(prompt, /focused clarifying questions/i);
  });

  it("describes an image and offers QA options when no task is specified", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "Uploaded an image.",
      mode: "general",
    });
    const prompt = buildPrompt("general", "Uploaded an image.", {
      hasImage: true,
    });

    assert.equal(analysis.intent, "visual_context");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
    assert.match(prompt, /Briefly describe what appears to be visible/i);
    assert.match(prompt, /QA visual review/i);

    for (const heading of artifactHeadings) {
      assert.doesNotMatch(prompt, textPattern(heading));
    }
  });

  it("summarizes attached text/data files without forcing visual review", () => {
    const analysis = analyzeQaWorkflow({
      hasTextAttachment: true,
      message: "Uploaded an attachment.",
      mode: "screenshot_review",
    });
    const prompt = buildPrompt("screenshot_review", "Uploaded an attachment.", {
      hasTextAttachment: true,
    });

    assert.equal(analysis.intent, "file_context");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
    assert.match(prompt, /attached text or data files/i);
    assert.doesNotMatch(prompt, /# Visual QA Review/);
  });
});

function textPattern(text: string) {
  return new RegExp(escapeRegExp(text));
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
