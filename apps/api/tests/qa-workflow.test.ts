import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeQaWorkflow } from "../src/modules/ai/qa-workflow.ts";

describe("QA workflow analysis", () => {
  it("uses conversational handling for thanks even when an artifact mode is selected", () => {
    const analysis = analyzeQaWorkflow({
      message: "thanks",
      mode: "checklist",
    });

    assert.equal(analysis.intent, "conversational");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("infers artifact intent from the latest message when general mode is selected", () => {
    const analysis = analyzeQaWorkflow({
      message: "write a bug report for a login button that does not work",
      mode: "general",
    });

    assert.equal(analysis.intent, "bug_report");
    assert.equal(analysis.effectiveMode, "bug_report");
    assert.equal(analysis.shouldUseArtifactTemplate, true);
  });

  it("keeps screenshot review intent when an image is attached", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "what should I test here?",
      mode: "general",
    });

    assert.equal(analysis.intent, "screenshot_review");
    assert.equal(analysis.effectiveMode, "screenshot_review");
  });

  it("detects Arabic requests", () => {
    const analysis = analyzeQaWorkflow({
      message: "اعمل حالات اختبار لصفحة تسجيل الدخول",
      mode: "general",
    });

    assert.equal(analysis.language, "arabic");
    assert.equal(analysis.intent, "test_cases");
  });
});
