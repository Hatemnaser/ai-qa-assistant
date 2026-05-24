import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeAiModel } from "../src/modules/ai/routing/model-router.ts";
import { analyzeQaWorkflow } from "../src/modules/ai/qa-workflow.ts";
import { resolveAiModel } from "../src/modules/ai/provider-registry.ts";

describe("AI model router", () => {
  it("uses the high-volume general model for text QA workflows", () => {
    const result = routeAiModel({
      hasImage: false,
      hasTextAttachment: false,
      requestedModel: resolveAiModel({ model: "gemini-2.5-flash" }),
      resolveModel: resolveAiModel,
      workflow: analyzeQaWorkflow({
        message: "write test cases for login",
        mode: "general",
      }),
    });

    assert.equal(result.model.model, "gemini-3.1-flash-lite");
    assert.equal(result.routing.source, "policy");
  });

  it("uses the visual model for image workflows", () => {
    const result = routeAiModel({
      hasImage: true,
      hasTextAttachment: false,
      requestedModel: resolveAiModel({ model: "gemini-3.1-flash-lite" }),
      resolveModel: resolveAiModel,
      workflow: analyzeQaWorkflow({
        hasImage: true,
        message: "review this screen",
        mode: "general",
      }),
    });

    assert.equal(result.model.model, "gemini-2.5-flash");
    assert.equal(result.routing.reason, "Visual/image workflow uses the configured visual model.");
  });

  it("keeps the requested model when it already matches the policy", () => {
    const result = routeAiModel({
      hasImage: false,
      hasTextAttachment: false,
      requestedModel: resolveAiModel({ model: "gemini-3.1-flash-lite" }),
      resolveModel: resolveAiModel,
      workflow: analyzeQaWorkflow({
        message: "thanks",
        mode: "general",
      }),
    });

    assert.equal(result.model.model, "gemini-3.1-flash-lite");
    assert.equal(result.routing.source, "requested");
  });
});
