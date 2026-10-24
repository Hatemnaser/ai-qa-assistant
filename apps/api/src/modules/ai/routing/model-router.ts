import { env } from "../../../config/env.js";
import type { AiModelRouting, AiResolvedModel } from "../ai.types.js";
import type { QaWorkflowAnalysis } from "../qa-workflow.js";
import { AUTO_AI_MODEL, assertAiModelCapabilities, getAiModelCatalog } from "../provider-registry.js";

export type AiModelResolver = (input?: { model?: string; provider?: string }) => AiResolvedModel;

export interface AiModelRouterInput {
  hasImage: boolean;
  hasTextAttachment: boolean;
  requestedModel: AiResolvedModel;
  requestedSelection?: string;
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
  requestedSelection,
  resolveModel,
  workflow,
}: AiModelRouterInput): AiModelRouterResult {
  if (requestedSelection !== AUTO_AI_MODEL) {
    return requestedModelResult(requestedModel, "Explicit model selection.");
  }
  if (!env.aiModelRouterEnabled) {
    return autoModelResult(requestedModel, "Auto uses the default model because model routing is disabled.", "policy");
  }

  const targetModel = getPolicyTargetModel({
    hasImage,
    hasTextAttachment,
    workflow,
  });

  const candidates = new Set([targetModel, env.aiFallbackModel, requestedModel.model,
    ...getAiModelCatalog().filter(model => model.provider === requestedModel.provider).map(model => model.value)]);
  for (const candidate of candidates) {
    const model = tryResolveModel(resolveModel, candidate, requestedModel.provider, { images: hasImage, textAttachments: hasTextAttachment });
    if (!model) continue;
    return autoModelResult(model, candidate === targetModel
      ? getRoutingReason({ hasImage, hasTextAttachment, workflow })
      : `Auto policy model ${targetModel} is unavailable or incompatible; using ${model.model}.`,
      candidate === targetModel ? "policy" : "fallback");
  }
  // Produce the existing capability error before usage reservation/provider calls.
  assertAiModelCapabilities(requestedModel.config, { images: hasImage, textAttachments: hasTextAttachment });
  return autoModelResult(requestedModel, "Auto uses the default model.", "policy");
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

function autoModelResult(model: AiResolvedModel, reason: string, source: "policy" | "fallback"): AiModelRouterResult {
  return { model, routing: { reason, requestedModel: AUTO_AI_MODEL, selectedModel: model.model, source } };
}

function tryResolveModel(resolveModel: AiModelResolver, model: string, provider: string, capabilities: { images: boolean; textAttachments: boolean }) {
  try {
    const resolved = resolveModel({ model, provider });
    assertAiModelCapabilities(resolved.config, capabilities);
    return resolved;
  } catch {
    return undefined;
  }
}
