import { env } from "../../../config/env.js";
import { AppError } from "../../../lib/errors.js";
import type { AiProviderId } from "../ai.types.js";
import type { EmbeddingProviderAdapter } from "./embedding.types.js";
import { createGeminiEmbeddingProvider } from "./gemini-embedding.provider.js";

const geminiEmbeddingProvider = createGeminiEmbeddingProvider({
  apiKey: env.geminiApiKey,
  dimensions: env.embeddingDimensions,
  model: env.geminiEmbeddingModel,
  timeoutMs: env.embeddingTimeoutMs,
});

const providers = [geminiEmbeddingProvider] as const;
const providersById = new Map<AiProviderId, EmbeddingProviderAdapter>(
  providers.map((provider) => [provider.id, provider])
);

export function resolveEmbeddingProvider(
  providerId = env.embeddingProvider
): EmbeddingProviderAdapter {
  const normalizedProviderId = providerId.trim() as AiProviderId;
  const provider = providersById.get(normalizedProviderId);

  if (!provider) {
    throw new AppError(
      `Unsupported embedding provider: ${providerId}.`,
      500,
      "UNSUPPORTED_EMBEDDING_PROVIDER"
    );
  }

  return provider;
}
