import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrompt } from "../src/modules/ai/prompt-templates.ts";
import { analyzeQaWorkflow, type QaWorkflowIntent } from "../src/modules/ai/qa-workflow.ts";

const artifactHeadings = [
  "# Test Cases",
  "# Bug Report",
  "# Edge Case Analysis",
  "# QA Checklist",
  "# Screenshot QA Review",
];

describe("AI behavior contract", () => {
  const artifactCases: Array<{
    expectedHeading: string;
    expectedIntent: QaWorkflowIntent;
    hasImage?: boolean;
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
      expectedHeading: "# Screenshot QA Review",
      expectedIntent: "screenshot_review",
      hasImage: true,
      message: "what should I test here?",
      mode: "general",
      name: "screenshot review request from attachment",
    },
    {
      expectedHeading: "# Test Cases",
      expectedIntent: "test_cases",
      message: "اعمل حالات اختبار لصفحة تسجيل الدخول",
      mode: "general",
      name: "Arabic test case request",
    },
  ];

  for (const testCase of artifactCases) {
    it(`creates the right QA artifact for ${testCase.name}`, () => {
      const analysis = analyzeQaWorkflow({
        hasImage: testCase.hasImage,
        message: testCase.message,
        mode: testCase.mode,
      });
      const prompt = buildPrompt(testCase.mode, testCase.message, {
        hasImage: testCase.hasImage,
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
      expectedIntent: "clarification",
      message: "شو الخطوة بعدا؟",
      mode: "bug_report",
      name: "Arabic next-step follow-up",
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
});

function textPattern(text: string) {
  return new RegExp(escapeRegExp(text));
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
