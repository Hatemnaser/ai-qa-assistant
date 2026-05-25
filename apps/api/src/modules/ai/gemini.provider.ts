import { GoogleGenAI } from "@google/genai";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { AiChatInput, AiChatResponse, AiHistoryMessage, AiProviderAdapter } from "./ai.types.js";
import { normalizeGeminiError } from "./gemini.errors.js";
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODELS,
  GEMINI_PROVIDER_ID,
  normalizeGeminiModel,
} from "./gemini.models.js";
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
  const images = getInputImages(input);
  const textAttachments = getTextAttachments(input);

  const prompt = addHistoryContext(
    addAttachmentContext(
      buildPrompt(input.mode, input.message, {
        analysis: input.workflow,
        hasImage: images.length > 0,
        hasTextAttachment: textAttachments.length > 0,
        history: input.history,
      }),
      textAttachments
    ),
    input.history
  );
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

function getInputImages(input: AiChatInput) {
  const images = input.images?.length ? input.images : input.image ? [input.image] : [];

  return images.filter((image) => image.data && image.mimeType);
}

function getTextAttachments(input: AiChatInput) {
  return (input.attachments || []).filter((attachment) => attachment.content.trim());
}

function addAttachmentContext(prompt: string, attachments: AiChatInput["attachments"] = []) {
  const textAttachments = attachments;

  if (textAttachments.length === 0) return prompt;

  const attachmentContext = textAttachments.map(formatTextAttachment).join("\n\n");

  return `Attached file context:
${attachmentContext}

Use the attached file content as context for the latest user request. If the user only uploaded the file without a specific task, briefly summarize what the file appears to contain and ask which QA workflow they want next.

${prompt}`;
}

function formatTextAttachment(attachment: NonNullable<AiChatInput["attachments"]>[number]) {
  return `File: ${attachment.name || "attachment"}
MIME type: ${attachment.mimeType}
Content:
<<<ATTACHMENT_CONTENT
${attachment.content}
ATTACHMENT_CONTENT`;
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
