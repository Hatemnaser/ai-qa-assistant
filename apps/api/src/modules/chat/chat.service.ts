import type { AiChatInput, AiChatResponse, AiTextAttachment } from "../ai/ai.types.js";
import {
  assertAiModelCapabilities,
  chatWithAi,
  resolveAiModel,
} from "../ai/provider-registry.js";
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
    const providerAttachments = getProviderAttachments(input);
    assertAiModelCapabilities(resolvedModel.config, {
      images: providerAttachments.images.length > 0,
      textAttachments: providerAttachments.attachments.length > 0,
    });

    const usage = await reserveUsage?.({
      guestId: context.guestId,
      ipAddress: context.ipAddress,
      userId: context.userId,
    });
    const response = await chatWithAi({
      history: input.history,
      ...(providerAttachments.attachments.length > 0 ? { attachments: providerAttachments.attachments } : {}),
      ...(providerAttachments.images.length > 0 ? { images: providerAttachments.images } : {}),
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

function getProviderAttachments(input: ChatRequest) {
  const textAttachments: AiTextAttachment[] = [];
  const images = input.image ? [input.image] : [];

  for (const attachment of input.attachments || []) {
    if (attachment.type === "image") {
      images.push({
        data: attachment.data,
        mimeType: attachment.mimeType,
      });
      continue;
    }

    textAttachments.push({
      type: "file" as const,
      name: attachment.name,
      mimeType: attachment.mimeType,
      content: attachment.content,
    });
  }

  return {
    attachments: textAttachments,
    images,
  };
}

export const { createChatReply } = createChatService({
  chatWithAi,
  reserveUsage: usageService.reserveChatMessage,
});
