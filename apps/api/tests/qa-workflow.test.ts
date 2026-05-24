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

  it("keeps visual review intent when an image is attached", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "what should I test here?",
      mode: "general",
    });

    assert.equal(analysis.intent, "screenshot_review");
    assert.equal(analysis.effectiveMode, "screenshot_review");
  });

  it("uses a clear artifact request instead of forcing image review", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "create test cases from this screen",
      mode: "general",
    });

    assert.equal(analysis.intent, "test_cases");
    assert.equal(analysis.effectiveMode, "test_cases");
  });

  it("uses visual context handling for images without a specific request", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "Uploaded an image.",
      mode: "general",
    });

    assert.equal(analysis.intent, "visual_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("uses the latest attached image even when the text is only a brief reaction", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "waw",
      mode: "general",
    });

    assert.equal(analysis.intent, "visual_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("uses the latest attached image for visual clarification questions", () => {
    const analysis = analyzeQaWorkflow({
      hasImage: true,
      message: "can you explain this?",
      mode: "general",
    });

    assert.equal(analysis.intent, "visual_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("uses file context handling for text attachments without a specific request", () => {
    const analysis = analyzeQaWorkflow({
      hasTextAttachment: true,
      message: "Uploaded an attachment.",
      mode: "screenshot_review",
    });

    assert.equal(analysis.intent, "file_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("uses the latest attached text file for brief reactions in general mode", () => {
    const analysis = analyzeQaWorkflow({
      hasTextAttachment: true,
      message: "thanks",
      mode: "general",
    });

    assert.equal(analysis.intent, "file_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("uses the latest attached text file for clarification questions", () => {
    const analysis = analyzeQaWorkflow({
      hasTextAttachment: true,
      message: "can you explain this?",
      mode: "general",
    });

    assert.equal(analysis.intent, "file_context");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("keeps selected artifact mode for text attachments when it is not visual review", () => {
    const analysis = analyzeQaWorkflow({
      hasTextAttachment: true,
      message: "Uploaded an attachment.",
      mode: "test_cases",
    });

    assert.equal(analysis.intent, "test_cases");
    assert.equal(analysis.effectiveMode, "test_cases");
    assert.equal(analysis.shouldUseArtifactTemplate, true);
  });

  it("does not force visual review for short reactions without a new image", () => {
    const analysis = analyzeQaWorkflow({
      message: "waw",
      mode: "screenshot_review",
    });

    assert.equal(analysis.intent, "conversational");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("does not let older visual context override the latest brief follow-up", () => {
    const analysis = analyzeQaWorkflow({
      history: [
        {
          content: "Uploaded an image.",
          mode: "screenshot_review",
          role: "user",
        },
      ],
      message: "thanks",
      mode: "screenshot_review",
    });

    assert.equal(analysis.intent, "conversational");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.shouldUseArtifactTemplate, false);
  });

  it("keeps Arabic language detection but leaves Arabic intent to the AI router", () => {
    const analysis = analyzeQaWorkflow({
      message: "اعمل حالات اختبار لصفحة تسجيل الدخول",
      mode: "general",
    });

    assert.equal(analysis.language, "arabic");
    assert.equal(analysis.intent, "general_qa");
    assert.equal(analysis.source, "fallback");
  });
});
