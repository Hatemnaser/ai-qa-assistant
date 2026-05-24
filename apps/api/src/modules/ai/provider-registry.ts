import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type {
  AiChatInput,
  AiChatResponse,
  AiModelCapabilities,
  AiModelConfig,
  AiProviderAdapter,
  AiProviderId,
  AiResolvedModel,
} from "./ai.types.js";
import { geminiProvider } from "./gemini.provider.js";

export const AI_PROVIDERS = [geminiProvider] as const satisfies readonly AiProviderAdapter[];

export const AI_MODEL_CATALOG = AI_PROVIDERS.flatMap((provider) => provider.models);
export const FALLBACK_AI_PROVIDER = geminiProvider.id;
export const FALLBACK_AI_MODEL = geminiProvider.defaultModel;

const providersById = new Map<AiProviderId, AiProviderAdapter>(
  AI_PROVIDERS.map((provider) => [provider.id, provider])
);

const modelsByValue: Map<string, AiModelConfig> = new Map(
  AI_MODEL_CATALOG.map((model) => [model.value, model])
);

export function resolveAiModel(input: { model?: string; provider?: string } = {}): AiResolvedModel {
  const requestedProvider = normalizeProvider(input.provider || env.aiProvider);
  const requestedModel = normalizeString(input.model);

  if (requestedProvider && !providersById.has(requestedProvider)) {
    throw new AppError(
      `Unsupported AI provider: ${requestedProvider}. Allowed providers: ${getAllowedProviderIds().join(", ")}.`,
      400,
      "UNSUPPORTED_AI_PROVIDER"
    );
  }

  const selectedProvider = providersById.get(requestedProvider || FALLBACK_AI_PROVIDER) || geminiProvider;

  if (!requestedModel) {
    return resolveKnownModel(selectedProvider.defaultModel);
  }

  const modelConfig = modelsByValue.get(requestedModel);

  if (!modelConfig) {
    throw unsupportedModelError(requestedModel);
  }

  if (requestedProvider && modelConfig.provider !== requestedProvider) {
    const allowedModels = getModelsForProvider(requestedProvider).map((model) => model.value);

    throw new AppError(
      `Unsupported ${requestedProvider} model: ${requestedModel}. Allowed models: ${allowedModels.join(", ")}.`,
      400,
      "UNSUPPORTED_MODEL"
    );
  }

  return {
    config: modelConfig,
    model: modelConfig.value,
    provider: modelConfig.provider,
  };
}

export async function chatWithAi(input: AiChatInput): Promise<AiChatResponse> {
  const resolved = resolveAiModel({
    model: input.model,
    provider: input.provider,
  });
  const provider = getAiProvider(resolved.provider);

  return provider.chat({
    ...input,
    model: resolved.model,
    provider: resolved.provider,
  });
}

export function getAiProvider(providerId: AiProviderId) {
  return providersById.get(providerId) || geminiProvider;
}

export function getAllowedModelValues() {
  return AI_MODEL_CATALOG.map((model) => model.value);
}

export function getAllowedProviderIds() {
  return AI_PROVIDERS.map((provider) => provider.id);
}

export function getAiModelCatalog() {
  return AI_MODEL_CATALOG.map((model) => ({
    capabilities: model.capabilities,
    label: model.label,
    provider: model.provider,
    recommendedFor: model.recommendedFor,
    value: model.value,
  }));
}

export function assertAiModelCapabilities(
  model: AiModelConfig,
  requiredCapabilities: Partial<AiModelCapabilities>
) {
  const unsupportedCapabilities = Object.entries(requiredCapabilities)
    .filter(([, required]) => required)
    .map(([capability]) => capability as keyof AiModelCapabilities)
    .filter((capability) => !model.capabilities[capability]);

  if (unsupportedCapabilities.length === 0) return;

  throw new AppError(
    `Model ${model.value} does not support ${formatCapabilities(unsupportedCapabilities)}.`,
    400,
    "UNSUPPORTED_MODEL_CAPABILITY"
  );
}

function resolveKnownModel(model: string): AiResolvedModel {
  const modelConfig = modelsByValue.get(model);

  if (!modelConfig) {
    throw unsupportedModelError(model);
  }

  return {
    config: modelConfig,
    model: modelConfig.value,
    provider: modelConfig.provider,
  };
}

function getModelsForProvider(providerId: AiProviderId) {
  return AI_MODEL_CATALOG.filter((model) => model.provider === providerId);
}

function normalizeProvider(provider: string | undefined): AiProviderId | undefined {
  const value = normalizeString(provider);

  return value ? (value as AiProviderId) : undefined;
}

function normalizeString(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function unsupportedModelError(model: string) {
  return new AppError(
    `Unsupported AI model: ${model}. Allowed models: ${getAllowedModelValues().join(", ")}.`,
    400,
    "UNSUPPORTED_MODEL"
  );
}

function formatCapabilities(capabilities: Array<keyof AiModelCapabilities>) {
  const labels = capabilities.map((capability) => {
    if (capability === "textAttachments") return "text/data file attachments";
    if (capability === "images") return "image attachments";
    return "text prompts";
  });

  return labels.join(" or ");
}
