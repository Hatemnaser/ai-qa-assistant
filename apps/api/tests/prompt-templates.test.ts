import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrompt } from "../src/modules/ai/prompt-templates.ts";

describe("prompt templates", () => {
  it("does not force artifact formats for short conversational follow-ups", () => {
    const prompt = buildPrompt("checklist", "thanks");

    assert.match(prompt, /Do not force a QA artifact format/);
    assert.doesNotMatch(prompt, /# QA Checklist/);
  });

  it("answers language preference follow-ups conversationally", () => {
    const prompt = buildPrompt("bug_report", "can you speak arabic");

    assert.match(prompt, /language change/);
    assert.doesNotMatch(prompt, /# Bug Report/);
  });

  it("keeps the selected artifact mode for real QA requests", () => {
    const prompt = buildPrompt("bug_report", "login button does not work");

    assert.match(prompt, /# Bug Report/);
    assert.match(prompt, /login button does not work/);
  });

  it("infers a QA artifact from the latest message when general mode is selected", () => {
    const prompt = buildPrompt("general", "create test cases for a checkout page");

    assert.match(prompt, /# Test Cases/);
    assert.match(prompt, /checkout page/);
  });

  it("asks focused questions for underspecified artifact requests", () => {
    const prompt = buildPrompt("test_cases", "login");

    assert.match(prompt, /underspecified/i);
    assert.match(prompt, /clarifying questions/i);
  });

  it("uses file context instead of visual review for text attachments", () => {
    const prompt = buildPrompt("screenshot_review", "Uploaded an attachment.", {
      hasTextAttachment: true,
    });

    assert.match(prompt, /attached text or data files/i);
    assert.match(prompt, /Do not mention screenshots or ask for an image/i);
    assert.doesNotMatch(prompt, /# Visual QA Review/);
  });

  it("uses selected artifact mode for text attachments when the mode is clear", () => {
    const prompt = buildPrompt("test_cases", "Uploaded an attachment.", {
      hasTextAttachment: true,
    });

    assert.match(prompt, /# Test Cases/);
  });
});
