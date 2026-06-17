import type {
  AiChatInput,
  AiChatResponse,
  AiContextEnvelope,
  AiHistoryMessage,
  AiMemoryContext,
  AiTextAttachment,
} from "../ai/ai.types.js";
import { chatWithAiFallback } from "../ai/model-fallback.js";
import { routeAiModel } from "../ai/routing/model-router.js";
import {
  assertAiModelCapabilities,
  chatWithAi,
  routeWorkflowWithAi,
  resolveAiModel,
} from "../ai/provider-registry.js";
import { analyzeQaWorkflowWithRouter } from "../ai/routing/workflow-router.js";
import { shouldUseAiWorkflowRouter, type WorkflowRouter } from "../ai/routing/workflow-router.js";
import { env } from "../../config/env.js";
import {
  memoryContextService,
  type PreparedChatMemoryContext,
} from "../memory/memory-context.service.js";
import { estimateChatCredits, type ChatCreditEstimate } from "../usage/credit-policy.js";
import { chatHistoryService } from "../chat-history/chat-history.service.js";
import { conversationSummaryService } from "../conversation-summary/conversation-summary.service.js";
import {
  usageService,
  type ChatUsageCompletionInput,
  type ChatUsageFailureInput,
} from "../usage/usage.service.js";
import type { UsageIdentity, UsageReservation } from "../usage/usage.types.js";
import type { ChatRequest, ChatRequestContext } from "./chat.types.js";

type ChatAiProvider = (input: AiChatInput) => Promise<AiChatResponse>;
type ChatUsageGuard = (
  identity: UsageIdentity,
  estimate: ChatCreditEstimate
) => Promise<UsageReservation | undefined>;
type ChatUsageCompleter = (
  reservation: UsageReservation,
  completion: ChatUsageCompletionInput
) => Promise<UsageReservation>;
type ChatUsageFailureHandler = (
  reservation: UsageReservation,
  failure?: ChatUsageFailureInput
) => Promise<UsageReservation>;
type ChatMemoryContextPreparer = (input: {
  projectId?: string | null;
  query: string;
  userId?: string;
}) => Promise<PreparedChatMemoryContext>;
type ChatMemoryContextResolver = (
  prepared: PreparedChatMemoryContext
) => Promise<AiMemoryContext | undefined>;
const CLIENT_HISTORY_MESSAGE_LIMIT = 8;

type ChatRecentTurnsLoader = (
  userId: string,
  chatId: string
) => Promise<AiHistoryMessage[] | undefined>;
type ChatConversationSummaryLoader = (
  userId: string,
  chatId: string
) => Promise<string | undefined>;

export interface ChatServiceDependencies {
  chatWithAi: ChatAiProvider;
  completeUsage?: ChatUsageCompleter;
  failUsage?: ChatUsageFailureHandler;
  loadConversationSummary?: ChatConversationSummaryLoader;
  loadRecentTurns?: ChatRecentTurnsLoader;
  prepareMemoryContext?: ChatMemoryContextPreparer;
  reserveUsage?: ChatUsageGuard;
  resolveMemoryContext?: ChatMemoryContextResolver;
  routeWorkflow?: WorkflowRouter;
}

export function createChatService({
  chatWithAi,
  completeUsage,
  failUsage,
  loadConversationSummary,
  loadRecentTurns,
  prepareMemoryContext,
  reserveUsage,
  resolveMemoryContext,
  routeWorkflow,
}: ChatServiceDependencies) {
  async function createChatReply(input: ChatRequest, context: ChatRequestContext = {}) {
    const requestedModel = typeof input.model === "string" ? input.model.trim() : undefined;
    const requestedProvider = typeof input.provider === "string" ? input.provider.trim() : undefined;

    const resolvedModel = resolveAiModel({
      model: requestedModel,
      provider: requestedProvider,
    });
    const providerAttachments = getProviderAttachments(input);
    const [conversationSummary, recentTurns] = await Promise.all([
      resolveConversationSummary({
        chatId: input.chatId,
        loadConversationSummary,
        userId: context.userId,
      }),
      resolveRecentTurns({
        chatId: input.chatId,
        clientHistory: input.history,
        loadRecentTurns,
        userId: context.userId,
      }),
    ]);
    const workflowInput = {
      hasImage: providerAttachments.images.length > 0,
      hasTextAttachment: providerAttachments.attachments.length > 0,
      history: recentTurns,
      message: input.message,
      mode: input.mode,
    };
    const preflightWorkflow = await analyzeQaWorkflowWithRouter(workflowInput, {
      enabled: false,
    });
    const preflightModelRouting = routeAiModel({
      hasImage: providerAttachments.images.length > 0,
      hasTextAttachment: providerAttachments.attachments.length > 0,
      requestedModel: resolvedModel,
      resolveModel: resolveAiModel,
      workflow: preflightWorkflow,
    });

    assertAiModelCapabilities(preflightModelRouting.model.config, {
      images: providerAttachments.images.length > 0,
      textAttachments: providerAttachments.attachments.length > 0,
    });
    const preparedMemoryContext = context.userId
      ? await prepareMemoryContext?.({
          projectId: input.projectId || null,
          query: input.message,
          userId: context.userId,
        })
      : undefined;

    const creditEstimate = estimateChatCredits({
      attachments: providerAttachments.attachments,
      conversationSummary,
      history: recentTurns,
      imageCount: providerAttachments.images.length,
      memoryContext: preparedMemoryContext?.context,
      message: input.message,
      mode: input.mode,
      model: preflightModelRouting.model.model,
      modelRouting: preflightModelRouting.routing,
      provider: preflightModelRouting.model.provider,
      usesWorkflowRouter:
        env.aiWorkflowRouterEnabled &&
        Boolean(routeWorkflow) &&
        shouldUseAiWorkflowRouter(workflowInput, preflightWorkflow),
      workflow: preflightWorkflow,
    });
    const usage = await reserveUsage?.(
      {
        guestId: context.guestId,
        ipAddress: context.ipAddress,
        userId: context.userId,
      },
      creditEstimate
    );
    let memoryContext = preparedMemoryContext?.context;

    if (preparedMemoryContext && resolveMemoryContext) {
      memoryContext =
        (await resolveMemoryContext(preparedMemoryContext)) ||
        preparedMemoryContext.context;
    }
    const workflow = await analyzeQaWorkflowWithRouter(workflowInput, {
      enabled: env.aiWorkflowRouterEnabled,
      minConfidence: env.aiWorkflowRouterMinConfidence,
      router: routeWorkflow,
    });
    const modelRouting = routeAiModel({
      hasImage: providerAttachments.images.length > 0,
      hasTextAttachment: providerAttachments.attachments.length > 0,
      requestedModel: resolvedModel,
      resolveModel: resolveAiModel,
      workflow,
    });

    let response: AiChatResponse;

    try {
      assertAiModelCapabilities(modelRouting.model.config, {
        images: providerAttachments.images.length > 0,
        textAttachments: providerAttachments.attachments.length > 0,
      });
      const aiContext = createAiContextEnvelope({
        attachments: providerAttachments.attachments,
        history: recentTurns,
        memoryContext,
        message: input.message,
        summary: conversationSummary,
      });

      response = await sendWithModelFallback(
        {
          context: aiContext,
          history: recentTurns,
          ...(providerAttachments.attachments.length > 0 ? { attachments: providerAttachments.attachments } : {}),
          ...(providerAttachments.images.length > 0 ? { images: providerAttachments.images } : {}),
          message: input.message,
          mode: input.mode,
          model: modelRouting.model.model,
          provider: modelRouting.model.provider,
          workflow,
        },
        {
          hasImages: providerAttachments.images.length > 0,
          hasTextAttachments: providerAttachments.attachments.length > 0,
          modelRouting: modelRouting.routing,
        }
      );
    } catch (error) {
      if (usage && failUsage) {
        try {
          await failUsage(usage, {
            model: modelRouting.model.model,
            provider: modelRouting.model.provider,
          });
        } catch {
          // Keep the original AI/provider error as the response error.
        }
      }

      throw error;
    }
    const completedUsage = await completeUsageAfterAiResponse({
      completeUsage,
      fallbackUsage: usage,
      modelRouting,
      response,
      workflow,
    });

    return {
      reply: response.reply,
      mode: response.workflow?.effectiveMode || workflow.effectiveMode,
      model: response.model || modelRouting.model.model,
      modelRouting: response.modelRouting || modelRouting.routing,
      provider: response.provider || modelRouting.model.provider,
      workflow: response.workflow || workflow,
      ...(completedUsage ? { usage: toPublicUsageSummary(completedUsage) } : {}),
    };
  }

  async function sendWithModelFallback(
    input: AiChatInput,
    options: {
      hasImages: boolean;
      hasTextAttachments: boolean;
      modelRouting: NonNullable<AiChatResponse["modelRouting"]>;
    }
  ) {
    return chatWithAiFallback({
      chatWithAi,
      input,
      requiredCapabilities: {
        hasImages: options.hasImages,
        hasTextAttachments: options.hasTextAttachments,
      },
      routing: options.modelRouting,
    });
  }

  return {
    createChatReply,
  };
}

async function completeUsageAfterAiResponse(input: {
  completeUsage?: ChatUsageCompleter;
  fallbackUsage?: UsageReservation;
  modelRouting: ReturnType<typeof routeAiModel>;
  response: AiChatResponse;
  workflow: Awaited<ReturnType<typeof analyzeQaWorkflowWithRouter>>;
}) {
  if (!input.fallbackUsage || !input.completeUsage) return input.fallbackUsage;

  try {
    return await input.completeUsage(input.fallbackUsage, {
      mode: input.response.workflow?.effectiveMode || input.workflow.effectiveMode,
      model: input.response.model || input.modelRouting.model.model,
      modelRoutingSource: (input.response.modelRouting || input.modelRouting.routing).source,
      outputTokens: input.response.usage?.outputTokens,
      promptTokens: input.response.usage?.inputTokens,
      provider: input.response.provider || input.modelRouting.model.provider,
      totalTokens: input.response.usage?.totalTokens,
      workflowIntent: (input.response.workflow || input.workflow).intent,
      workflowSource: (input.response.workflow || input.workflow).source,
    });
  } catch {
    return input.fallbackUsage;
  }
}

function toPublicUsageSummary(usage: UsageReservation) {
  return {
    limit: usage.limit,
    remaining: usage.remaining,
    unit: usage.unit,
    used: usage.used,
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

async function resolveRecentTurns(input: {
  chatId?: string;
  clientHistory: AiHistoryMessage[];
  loadRecentTurns?: ChatRecentTurnsLoader;
  userId?: string;
}) {
  if (!input.chatId || !input.userId || !input.loadRecentTurns) {
    return getBoundedClientHistory(input.clientHistory);
  }

  const storedTurns = await input.loadRecentTurns(input.userId, input.chatId);

  return storedTurns === undefined
    ? getBoundedClientHistory(input.clientHistory)
    : storedTurns;
}

function getBoundedClientHistory(history: AiHistoryMessage[]) {
  return history.slice(-CLIENT_HISTORY_MESSAGE_LIMIT);
}

async function resolveConversationSummary(input: {
  chatId?: string;
  loadConversationSummary?: ChatConversationSummaryLoader;
  userId?: string;
}) {
  if (!input.chatId || !input.userId || !input.loadConversationSummary) {
    return undefined;
  }

  const summary = await input.loadConversationSummary(input.userId, input.chatId);

  return summary?.trim() || undefined;
}

function createAiContextEnvelope(input: {
  attachments: AiTextAttachment[];
  history: AiChatInput["history"];
  memoryContext?: AiMemoryContext;
  message: string;
  summary?: string;
}): AiContextEnvelope {
  return {
    behavior: input.memoryContext?.behavior || {},
    conversation: {
      recentTurns: input.history,
      ...(input.summary ? { summary: input.summary } : {}),
    },
    currentMessage: input.message,
    durableMemory: input.memoryContext?.durableMemory || {
      account: [],
    },
    evidence: {
      attachments: input.attachments,
      projectDocuments: input.memoryContext?.evidence.projectDocuments || [],
    },
  };
}

export const { createChatReply } = createChatService({
  chatWithAi,
  completeUsage: usageService.completeChatCredits,
  failUsage: usageService.failChatCredits,
  loadConversationSummary: conversationSummaryService.loadConversationSummaryContext,
  loadRecentTurns: chatHistoryService.loadRecentCompleteTurns,
  prepareMemoryContext: memoryContextService.prepareChatMemoryContext,
  routeWorkflow: routeWorkflowWithAi,
  reserveUsage: usageService.reserveChatCredits,
  resolveMemoryContext: memoryContextService.resolveChatMemoryContext,
});
