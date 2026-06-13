import type { AiProviderId } from "../ai.types.js";

export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingInput {
  content: string;
  purpose: EmbeddingPurpose;
  title?: string;
}

export interface EmbeddingResult {
  dimensions: number;
  model: string;
  provider: AiProviderId;
  values: number[];
}

export interface EmbeddingProviderAdapter {
  dimensions: number;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
  id: AiProviderId;
  model: string;
}
