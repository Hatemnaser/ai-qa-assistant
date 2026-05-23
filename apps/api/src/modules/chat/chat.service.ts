import type { AiChatInput, AiChatResponse } from "../ai/ai.types.js";
import { chatWithAi, resolveAiModel } from "../ai/provider-registry.js";
import { AppError } from "../../lib/errors.js";
import { usageService } from "../usage/usage.service.js";
import type { UsageIdentity, UsageReservation } from "../usage/usage.types.js";
import type { ChatRequest, ChatRequestContext } from "./chat.types.js";

type ChatAiProvider = (input: AiChatInput) => Promise<AiChatResponse>;
type ChatUsageGuard = (identity: UsageIdentity) => Promise<UsageReservation | undefined>;

export interface ChatServiceDependencies {
  chatWithAi: ChatAiProvider;
  reserveUsage?: ChatUsageGuard;
}

export function createChatService({ chatWithAi, reserveUsage }: ChatServiceDependencies) {
  async function createChatReply(input: ChatRequest, context: ChatRequestContext = {}) {
    const requestedModel = typeof input.model === "string" ? input.model.trim() : undefined;
    const requestedProvider = typeof input.provider === "string" ? input.provider.trim() : undefined;

    const resolvedModel = resolveAiModel({
      model: requestedModel,
      provider: requestedProvider,
    });
    const image = getProviderImage(input);

    const usage = await reserveUsage?.({
      guestId: context.guestId,
      ipAddress: context.ipAddress,
      userId: context.userId,
    });
    const response = await chatWithAi({
      history: input.history,
      ...(image ? { image } : {}),
      message: input.message,
      mode: input.mode,
      model: resolvedModel.model,
      provider: resolvedModel.provider,
    });

    return {
      reply: response.reply,
      mode: input.mode,
      model: response.model || resolvedModel.model,
      provider: response.provider || resolvedModel.provider,
      ...(usage ? { usage } : {}),
    };
  }

  return {
    createChatReply,
  };
}

function getProviderImage(input: ChatRequest) {
  const attachment = input.attachments?.[0];

  if (!attachment) return input.image;

  if (attachment.type !== "image") {
    throw new AppError(
      "Only image attachments are supported for AI chat requests right now.",
      400,
      "UNSUPPORTED_ATTACHMENT_TYPE"
    );
  }

  return {
    data: attachment.data,
    mimeType: attachment.mimeType,
  };
}

export const { createChatReply } = createChatService({
  chatWithAi,
  reserveUsage: usageService.reserveChatMessage,
});
