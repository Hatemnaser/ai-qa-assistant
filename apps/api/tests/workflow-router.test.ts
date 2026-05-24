import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeQaWorkflow } from "../src/modules/ai/qa-workflow.ts";
import {
  analyzeQaWorkflowWithRouter,
  mergeRouterDecision,
  shouldUseAiWorkflowRouter,
} from "../src/modules/ai/routing/workflow-router.ts";

describe("AI workflow router", () => {
  it("keeps high-confidence local artifact decisions without calling the router", async () => {
    let routerWasCalled = false;

    const analysis = await analyzeQaWorkflowWithRouter(
      {
        message: "write test cases for login",
        mode: "general",
      },
      {
        enabled: true,
        router: async () => {
          routerWasCalled = true;
          return undefined;
        },
      }
    );

    assert.equal(routerWasCalled, false);
    assert.equal(analysis.intent, "test_cases");
    assert.equal(analysis.source, "local_rule");
  });

  it("lets the router classify multilingual artifact requests the local rules miss", async () => {
    const analysis = await analyzeQaWorkflowWithRouter(
      {
        message: "Erstelle bitte einen Fehlerbericht fuer den Login Fehler",
        mode: "general",
      },
      {
        enabled: true,
        router: async () => ({
          confidence: 0.93,
          intent: "bug_report",
          language: "unknown",
        }),
      }
    );

    assert.equal(analysis.intent, "bug_report");
    assert.equal(analysis.effectiveMode, "bug_report");
    assert.equal(analysis.source, "ai_router");
  });

  it("routes Arabic artifact requests through the AI router instead of local word lists", async () => {
    const analysis = await analyzeQaWorkflowWithRouter(
      {
        message: "اعملي حالات اختبار لصفحة تسجيل الدخول",
        mode: "general",
      },
      {
        enabled: true,
        router: async () => ({
          confidence: 0.95,
          intent: "test_cases",
          language: "arabic",
        }),
      }
    );

    assert.equal(analysis.intent, "test_cases");
    assert.equal(analysis.effectiveMode, "test_cases");
    assert.equal(analysis.language, "arabic");
    assert.equal(analysis.source, "ai_router");
  });

  it("routes Arabic follow-ups through the AI router instead of selected mode", async () => {
    const analysis = await analyzeQaWorkflowWithRouter(
      {
        message: "شو الخطوة بعدا؟",
        mode: "bug_report",
      },
      {
        enabled: true,
        router: async () => ({
          confidence: 0.9,
          intent: "clarification",
          language: "arabic",
        }),
      }
    );

    assert.equal(analysis.intent, "clarification");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.source, "ai_router");
  });

  it("uses router decisions to avoid forcing the selected artifact mode", async () => {
    const localAnalysis = analyzeQaWorkflow({
      message: "شكرااااا",
      mode: "bug_report",
    });

    assert.equal(localAnalysis.source, "selected_mode");
    assert.equal(shouldUseAiWorkflowRouter({ message: "شكرااااا", mode: "bug_report" }, localAnalysis), true);

    const analysis = mergeRouterDecision(
      {
        message: "شكرااااا",
        mode: "bug_report",
      },
      localAnalysis,
      {
        confidence: 0.91,
        intent: "conversational",
        language: "arabic",
      }
    );

    assert.equal(analysis.intent, "conversational");
    assert.equal(analysis.effectiveMode, "general");
    assert.equal(analysis.language, "arabic");
    assert.equal(analysis.source, "ai_router");
  });

  it("ignores low-confidence router decisions", () => {
    const localAnalysis = analyzeQaWorkflow({
      message: "login",
      mode: "test_cases",
    });

    const analysis = mergeRouterDecision(
      {
        message: "login",
        mode: "test_cases",
      },
      localAnalysis,
      {
        confidence: 0.41,
        intent: "conversational",
      }
    );

    assert.equal(analysis.intent, localAnalysis.intent);
    assert.equal(analysis.source, localAnalysis.source);
  });
});
