import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AiChatInput, AiChatResponse, AiModelRouting, AiProviderAdapter } from "./ai.types.js";
import { AUTO_AI_MODEL, assertAiModelCapabilities, getAiModelCatalog, resolveAiModel } from "./provider-registry.js";

type ChatAiProvider = AiProviderAdapter["chat"];

export interface AiFallbackInput {
  chatWithAi: ChatAiProvider;
  input: AiChatInput;
  onProviderAttempt?: (input: AiChatInput) => Promise<void> | void;
  requiredCapabilities: {
    hasImages: boolean;
    hasTextAttachments: boolean;
  };
  routing: AiModelRouting;
}

export async function chatWithAiFallback({
  chatWithAi,
  input,
  onProviderAttempt,
  requiredCapabilities,
  routing,
}: AiFallbackInput): Promise<AiChatResponse> {
  try {
    return await callModel(chatWithAi, input, routing, onProviderAttempt);
  } catch (error) {
    if (routing.requestedModel !== AUTO_AI_MODEL || !shouldFallbackToAnotherModel(error)) throw error;

    return sendWithFallbackCandidates({
      chatWithAi,
      firstError: error,
      input,
      onProviderAttempt,
      requiredCapabilities,
      routing,
    });
  }
}

async function sendWithFallbackCandidates(input: AiFallbackInput & { firstError: unknown }) {
  let lastError = input.firstError;

  for (const model of getFallbackModelCandidates(input.input.model)) {
    let resolved;
    try {
      resolved = resolveAiModel({ model, provider: input.input.provider });
      assertAiModelCapabilities(resolved.config, {
        images: input.requiredCapabilities.hasImages,
        textAttachments: input.requiredCapabilities.hasTextAttachments,
      });
    } catch (error) {
      continue;
    }

    try {
      return await callModel(input.chatWithAi, {
        ...input.input,
        model: resolved.model,
        provider: resolved.provider,
      }, {
          reason: `Primary model ${input.input.model} was unavailable or over quota; using ${resolved.model}.`,
          requestedModel: input.routing.requestedModel,
          selectedModel: resolved.model,
          source: "fallback" as const,
      }, input.onProviderAttempt);
    } catch (error) {
      if (!shouldFallbackToAnotherModel(error)) throw error;

      lastError = error;
    }
  }

  throw lastError;
}

async function callModel(provider: ChatAiProvider, input: AiChatInput, routing: AiModelRouting,
  onProviderAttempt?: AiFallbackInput["onProviderAttempt"]): Promise<AiChatResponse> {
  await onProviderAttempt?.(input);
  const response = await provider(input);
  if ((response.model && response.model !== input.model) || (response.provider && response.provider !== input.provider)) {
    throw new AppError("The AI provider returned an unexpected model. Retry or choose another model.", 502, "AI_MODEL_MISMATCH");
  }
  return { ...response, model: response.model || input.model!, provider: response.provider || input.provider,
    modelRouting: { ...routing, selectedModel: response.model || input.model! } };
}

function getFallbackModelCandidates(currentModel: string | undefined) {
  const candidates = [
    env.aiFallbackModel,
    env.aiGeneralModel,
    env.aiVisualModel,
    ...getAiModelCatalog().map((model) => model.value),
  ];
  const uniqueCandidates = new Set(candidates.filter(Boolean));

  if (currentModel) {
    uniqueCandidates.delete(currentModel);
  }

  return [...uniqueCandidates];
}

function shouldFallbackToAnotherModel(error: unknown) {
  return error instanceof AppError && (error.code === "QUOTA_EXCEEDED" || error.code === "MODEL_UNAVAILABLE");
}
