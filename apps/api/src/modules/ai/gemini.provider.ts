import { GoogleGenAI } from "@google/genai";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AiChatInput, AiChatResponse, AiHistoryMessage } from "./ai.types.js";
import { normalizeGeminiError } from "./gemini.errors.js";
import { GEMINI_DEFAULT_MODEL, normalizeGeminiModel } from "./gemini.models.js";
import { buildPrompt } from "./prompt-templates.js";

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

  const prompt = addHistoryContext(buildPrompt(input.mode, input.message), input.history);
  const contents =
    input.image && input.image.data && input.image.mimeType
      ? [
          {
            inlineData: {
              mimeType: input.image.mimeType,
              data: input.image.data,
            },
          },
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
    };
  } catch (error) {
    throw normalizeGeminiError(error, selectedModel);
  }
}

function addHistoryContext(prompt: string, history: AiHistoryMessage[]) {
  const textHistory = Array.isArray(history)
    ? history
        .filter((item) => item && typeof item.content === "string" && item.content.trim())
        .slice(-8)
    : [];

  if (textHistory.length === 0) return prompt;

  const context = textHistory
    .map((item) => `${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`)
    .join("\n");

  return `Recent conversation context:\n${context}\n\n${prompt}`;
}

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
