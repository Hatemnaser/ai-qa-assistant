import { AppError } from "../../lib/errors.js";
import {
  GEMINI_ALLOWED_MODELS,
  GEMINI_DEFAULT_MODEL,
  isAllowedGeminiModel,
} from "../ai/gemini.models.js";
import { chatWithGemini } from "../ai/gemini.provider.js";
import type { AiChatInput, AiChatResponse } from "../ai/ai.types.js";
import type { ChatRequest } from "./chat.types.js";

type ChatAiProvider = (input: AiChatInput) => Promise<AiChatResponse>;

export interface ChatServiceDependencies {
  chatWithAi: ChatAiProvider;
}

export function createChatService({ chatWithAi }: ChatServiceDependencies) {
  async function createChatReply(input: ChatRequest) {
    const requestedModel = typeof input.model === "string" ? input.model.trim() : undefined;

    if (requestedModel && !isAllowedGeminiModel(requestedModel)) {
      throw new AppError(
        `Unsupported Gemini model: ${requestedModel}. Allowed models: ${GEMINI_ALLOWED_MODELS.join(", ")}.`,
        400,
        "UNSUPPORTED_MODEL"
      );
    }

    const response = await chatWithAi({
      ...input,
      model: requestedModel,
    });

    return {
      reply: response.reply,
      mode: input.mode,
      model: response.model || GEMINI_DEFAULT_MODEL,
    };
  }

  return {
    createChatReply,
  };
}

export const { createChatReply } = createChatService({
  chatWithAi: chatWithGemini,
});
