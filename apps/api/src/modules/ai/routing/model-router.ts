import { env } from "../../../config/env.js";
import type { AiModelRouting, AiResolvedModel } from "../ai.types.js";
import type { QaWorkflowAnalysis } from "../qa-workflow.js";

export type AiModelResolver = (input?: { model?: string; provider?: string }) => AiResolvedModel;

export interface AiModelRouterInput {
  hasImage: boolean;
  hasTextAttachment: boolean;
  requestedModel: AiResolvedModel;
  resolveModel: AiModelResolver;
  workflow: QaWorkflowAnalysis;
}

export interface AiModelRouterResult {
  model: AiResolvedModel;
  routing: AiModelRouting;
}

export function routeAiModel({
  hasImage,
  hasTextAttachment,
  requestedModel,
  resolveModel,
  workflow,
}: AiModelRouterInput): AiModelRouterResult {
  if (!env.aiModelRouterEnabled) {
    return requestedModelResult(requestedModel, "Model router is disabled.");
  }

  const targetModel = getPolicyTargetModel({
    hasImage,
    hasTextAttachment,
    workflow,
  });

  if (!targetModel || targetModel === requestedModel.model) {
    return requestedModelResult(requestedModel, "Requested model already matches the routing policy.");
  }

  const resolvedPolicyModel = tryResolveModel(resolveModel, targetModel);

  if (resolvedPolicyModel) {
    return {
      model: resolvedPolicyModel,
      routing: {
        reason: getRoutingReason({
          hasImage,
          hasTextAttachment,
          workflow,
        }),
        requestedModel: requestedModel.model,
        selectedModel: resolvedPolicyModel.model,
        source: "policy",
      },
    };
  }

  const resolvedFallbackModel = tryResolveModel(resolveModel, env.aiFallbackModel);

  if (resolvedFallbackModel) {
    return {
      model: resolvedFallbackModel,
      routing: {
        reason: `Policy model ${targetModel} is unavailable; using configured fallback model.`,
        requestedModel: requestedModel.model,
        selectedModel: resolvedFallbackModel.model,
        source: "fallback",
      },
    };
  }

  return requestedModelResult(requestedModel, "Policy and fallback models are unavailable; using requested model.");
}

function getPolicyTargetModel(input: {
  hasImage: boolean;
  hasTextAttachment: boolean;
  workflow: QaWorkflowAnalysis;
}) {
  if (input.hasImage || input.workflow.intent === "screenshot_review" || input.workflow.intent === "visual_context") {
    return env.aiVisualModel;
  }

  if (input.hasTextAttachment) {
    return env.aiGeneralModel;
  }

  return env.aiGeneralModel;
}

function getRoutingReason(input: {
  hasImage: boolean;
  hasTextAttachment: boolean;
  workflow: QaWorkflowAnalysis;
}) {
  if (input.hasImage || input.workflow.intent === "screenshot_review" || input.workflow.intent === "visual_context") {
    return "Visual/image workflow uses the configured visual model.";
  }

  if (input.hasTextAttachment) {
    return "Text/data attachment workflow uses the configured general model.";
  }

  return `Workflow intent ${input.workflow.intent} uses the configured general model.`;
}

function requestedModelResult(model: AiResolvedModel, reason: string): AiModelRouterResult {
  return {
    model,
    routing: {
      reason,
      requestedModel: model.model,
      selectedModel: model.model,
      source: "requested",
    },
  };
}

function tryResolveModel(resolveModel: AiModelResolver, model: string) {
  try {
    return resolveModel({ model });
  } catch {
    return undefined;
  }
}
