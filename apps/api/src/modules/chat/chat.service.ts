import { AppError } from "../../lib/errors.js";
import {
  GEMINI_ALLOWED_MODELS,
  GEMINI_DEFAULT_MODEL,
  isAllowedGeminiModel,
} from "../ai/gemini.models.js";
import { chatWithGemini } from "../ai/gemini.provider.js";
import type { AiChatInput, AiChatResponse } from "../ai/ai.types.js";
import { usageService } from "../usage/usage.service.js";
import type { UsageIdentity } from "../usage/usage.types.js";
import type { ChatRequest, ChatRequestContext } from "./chat.types.js";

type ChatAiProvider = (input: AiChatInput) => Promise<AiChatResponse>;
type ChatUsageGuard = (identity: UsageIdentity) => Promise<unknown>;

export interface ChatServiceDependencies {
  chatWithAi: ChatAiProvider;
  reserveUsage?: ChatUsageGuard;
}

export function createChatService({ chatWithAi, reserveUsage }: ChatServiceDependencies) {
  async function createChatReply(input: ChatRequest, context: ChatRequestContext = {}) {
    const requestedModel = typeof input.model === "string" ? input.model.trim() : undefined;

    if (requestedModel && !isAllowedGeminiModel(requestedModel)) {
      throw new AppError(
        `Unsupported Gemini model: ${requestedModel}. Allowed models: ${GEMINI_ALLOWED_MODELS.join(", ")}.`,
        400,
        "UNSUPPORTED_MODEL"
      );
    }

    await reserveUsage?.({
      guestId: context.guestId,
      ipAddress: context.ipAddress,
      userId: context.userId,
    });

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
  reserveUsage: usageService.reserveChatMessage,
});
