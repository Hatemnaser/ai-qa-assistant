import { GoogleGenAI } from "@google/genai";

import { AppError } from "../../../lib/errors.js";
import { normalizeGeminiError } from "../gemini.errors.js";
import { GEMINI_PROVIDER_ID } from "../gemini.models.js";
import type {
  EmbeddingInput,
  EmbeddingProviderAdapter,
  EmbeddingResult,
} from "./embedding.types.js";

interface GeminiEmbeddingResponse {
  embeddings?: Array<{
    values?: number[];
  }>;
}

export interface GeminiEmbeddingClient {
  models: {
    embedContent(input: {
      config: {
        outputDimensionality: number;
      };
      contents: string;
      model: string;
    }): Promise<GeminiEmbeddingResponse>;
  };
}

export interface GeminiEmbeddingProviderOptions {
  apiKey: string;
  client?: GeminiEmbeddingClient;
  dimensions: number;
  model: string;
  timeoutMs: number;
}

export function createGeminiEmbeddingProvider({
  apiKey,
  client,
  dimensions,
  model,
  timeoutMs,
}: GeminiEmbeddingProviderOptions): EmbeddingProviderAdapter {
  if (!model.trim()) {
    throw new Error("Embedding model is required.");
  }

  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error("Embedding dimensions must be a positive integer.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("Embedding timeout must be a positive number.");
  }

  async function embed(input: EmbeddingInput): Promise<EmbeddingResult> {
    if (!apiKey) {
      throw new AppError(
        "GEMINI_API_KEY is not configured for project document embeddings.",
        500,
        "MISSING_EMBEDDING_API_KEY"
      );
    }

    const content = formatGeminiEmbeddingContent(input);

    try {
      const response = await withTimeout(
        getClient().models.embedContent({
          config: {
            outputDimensionality: dimensions,
          },
          contents: content,
          model,
        }),
        timeoutMs
      );
      const values = response.embeddings?.[0]?.values;

      if (
        !values ||
        values.length !== dimensions ||
        values.some((value) => !Number.isFinite(value))
      ) {
        throw new AppError(
          `Embedding model ${model} returned an invalid vector.`,
          502,
          "INVALID_EMBEDDING_RESPONSE"
        );
      }

      return {
        dimensions: values.length,
        model,
        provider: GEMINI_PROVIDER_ID,
        values,
      };
    } catch (error) {
      throw normalizeGeminiError(error, model);
    }
  }

  function getClient(): GeminiEmbeddingClient {
    return (
      client ||
      new GoogleGenAI({
        apiKey,
      })
    );
  }

  return {
    dimensions,
    embed,
    id: GEMINI_PROVIDER_ID,
    model,
  };
}

export function formatGeminiEmbeddingContent(input: EmbeddingInput) {
  const content = input.content.trim();

  if (input.purpose === "query") {
    return `task: question answering | query: ${content}`;
  }

  const title = input.title?.replace(/\s+/g, " ").trim() || "none";

  return `title: ${title} | text: ${content}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new AppError(
          "Embedding generation timed out.",
          504,
          "EMBEDDING_TIMEOUT"
        )
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}
