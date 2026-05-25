import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AiChatInput, AiChatResponse, AiModelRouting, AiProviderAdapter } from "./ai.types.js";
import { assertAiModelCapabilities, getAiModelCatalog, resolveAiModel } from "./provider-registry.js";

type ChatAiProvider = AiProviderAdapter["chat"];

export interface AiFallbackInput {
  chatWithAi: ChatAiProvider;
  input: AiChatInput;
  requiredCapabilities: {
    hasImages: boolean;
    hasTextAttachments: boolean;
  };
  routing: AiModelRouting;
}

export async function chatWithAiFallback({
  chatWithAi,
  input,
  requiredCapabilities,
  routing,
}: AiFallbackInput): Promise<AiChatResponse> {
  try {
    return await chatWithAi(input);
  } catch (error) {
    if (!shouldFallbackToAnotherModel(error)) throw error;

    return sendWithFallbackCandidates({
      chatWithAi,
      firstError: error,
      input,
      requiredCapabilities,
      routing,
    });
  }
}

async function sendWithFallbackCandidates(input: AiFallbackInput & { firstError: unknown }) {
  let lastError = input.firstError;

  for (const model of getFallbackModelCandidates(input.input.model)) {
    const resolved = resolveAiModel({
      model,
    });

    try {
      assertAiModelCapabilities(resolved.config, {
        images: input.requiredCapabilities.hasImages,
        textAttachments: input.requiredCapabilities.hasTextAttachments,
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    try {
      const response = await input.chatWithAi({
        ...input.input,
        model: resolved.model,
        provider: resolved.provider,
      });

      return {
        ...response,
        model: response.model || resolved.model,
        modelRouting: {
          reason: `Primary model ${input.input.model} was unavailable or over quota; using ${resolved.model}.`,
          requestedModel: input.routing.requestedModel,
          selectedModel: response.model || resolved.model,
          source: "fallback" as const,
        },
        provider: response.provider || resolved.provider,
      };
    } catch (error) {
      if (!shouldFallbackToAnotherModel(error)) throw error;

      lastError = error;
    }
  }

  throw lastError;
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
