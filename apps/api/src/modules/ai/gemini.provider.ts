import { GoogleGenAI } from "@google/genai";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AiChatInput, AiChatResponse, AiProviderAdapter } from "./ai.types.js";
import { normalizeGeminiError } from "./gemini.errors.js";
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODELS,
  GEMINI_PROVIDER_ID,
  normalizeGeminiModel,
} from "./gemini.models.js";
import { buildAiPromptWithContext, getInputImages } from "./prompt-context.js";

export async function chatWithGemini(input: AiChatInput): Promise<AiChatResponse> {
  if (!env.geminiApiKey) {
    throw new AppError(
      "GEMINI_API_KEY is not configured. Configure a Gemini API key before sending requests.",
      500,
      "MISSING_API_KEY"
    );
  }

  const selectedModel = normalizeGeminiModel(input.model || env.geminiModel || GEMINI_DEFAULT_MODEL);
  const ai = new GoogleGenAI({
    apiKey: env.geminiApiKey,
  });
  const images = getInputImages(input);
  const prompt = buildAiPromptWithContext(input);
  const contents =
    images.length > 0
      ? [
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          })),
          {
            text: prompt,
          },
        ]
      : prompt;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: selectedModel,
        contents,
        config: {
          maxOutputTokens: env.aiMaxOutputTokens,
          temperature: 0.3,
          thinkingConfig: {
            thinkingBudget: 0,
          },
        },
      }),
      env.aiTimeoutMs
    );

    return {
      reply: response.text || "",
      model: selectedModel,
      provider: GEMINI_PROVIDER_ID,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
      },
      ...(input.workflow ? { workflow: input.workflow } : {}),
    };
  } catch (error) {
    throw normalizeGeminiError(error, selectedModel);
  }
}

export const geminiProvider = {
  chat: chatWithGemini,
  defaultModel: GEMINI_DEFAULT_MODEL,
  id: GEMINI_PROVIDER_ID,
  label: "Gemini",
  models: GEMINI_MODELS,
} satisfies AiProviderAdapter;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new AppError("AI response timed out. Please try again.", 504, "AI_TIMEOUT"));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}
