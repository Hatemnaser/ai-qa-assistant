import { env } from "../../config/env.js";
import type { AiHistoryMessage, AiMemoryContext, AiModelRouting, AiTextAttachment } from "../ai/ai.types.js";
import type { QaWorkflowAnalysis } from "../ai/qa-workflow.js";

export interface ChatCreditEstimateInput {
  attachments: AiTextAttachment[];
  history: AiHistoryMessage[];
  imageCount: number;
  memoryContext?: AiMemoryContext;
  message: string;
  mode: string;
  model: string;
  modelRouting: AiModelRouting;
  provider: string;
  usesWorkflowRouter?: boolean;
  workflow: QaWorkflowAnalysis;
}

export interface ChatCreditEstimate {
  attachmentCount: number;
  credits: number;
  estimatedOutputTokens: number;
  estimatedPromptTokens: number;
  estimatedTotalTokens: number;
  fileCount: number;
  imageCount: number;
  mode: string;
  model: string;
  modelRoutingSource: string;
  provider: string;
  workflowIntent: string;
  workflowSource: string;
}

export interface ActualTokenUsageInput {
  fallbackCredits?: number;
  model?: string;
  outputTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export function estimateChatCredits(input: ChatCreditEstimateInput): ChatCreditEstimate {
  const messageTokens = estimateTextTokens(input.message);
  const historyTokens = estimateTextTokens(input.history.map((item) => item.content).join("\n"));
  const attachmentTokens = estimateTextTokens(input.attachments.map((attachment) => attachment.content).join("\n"));
  const memoryTokens = estimateMemoryTokens(input.memoryContext);
  const imageTokens = input.imageCount * 700;
  const usesWorkflowRouter = Boolean(input.usesWorkflowRouter || input.workflow.source === "ai_router");
  const routerTokens = usesWorkflowRouter ? 250 : 0;
  const estimatedPromptTokens = messageTokens + historyTokens + attachmentTokens + memoryTokens + imageTokens + routerTokens;
  const estimatedOutputTokens = estimateOutputTokens(input.mode, input.workflow.intent);
  const estimatedTotalTokens = estimatedPromptTokens + estimatedOutputTokens;
  const attachmentCredits =
    input.imageCount * getImageCredits() + input.attachments.length * getTextFileCredits();
  const routerCredits = usesWorkflowRouter ? getRouterCredits() : 0;
  const tokenCredits = Math.ceil(estimatedTotalTokens / getTokensPerCredit());
  const credits = normalizeCredits(
    Math.ceil((tokenCredits + attachmentCredits + routerCredits) * getModelCreditMultiplier(input.model))
  );

  return {
    attachmentCount: input.imageCount + input.attachments.length,
    credits,
    estimatedOutputTokens,
    estimatedPromptTokens,
    estimatedTotalTokens,
    fileCount: input.attachments.length,
    imageCount: input.imageCount,
    mode: input.mode,
    model: input.model,
    modelRoutingSource: input.modelRouting.source,
    provider: input.provider,
    workflowIntent: input.workflow.intent,
    workflowSource: input.workflow.source,
  };
}

export function calculateCreditsFromTokenUsage(input: ActualTokenUsageInput) {
  const totalTokens = input.totalTokens || sumKnownTokens(input.promptTokens, input.outputTokens);

  if (!totalTokens) {
    return normalizeCredits(input.fallbackCredits || 1);
  }

  return normalizeCredits(
    Math.ceil((totalTokens / getTokensPerCredit()) * getModelCreditMultiplier(input.model || ""))
  );
}

function estimateTextTokens(text: string) {
  const chars = text.trim().length;

  return chars ? Math.ceil(chars / 4) : 0;
}

function estimateOutputTokens(mode: string, intent: string) {
  if (intent === "conversational") return 250;
  if (mode === "bug_report" || intent === "bug_report") return 900;
  if (mode === "qa_checklist" || intent === "qa_checklist") return 1000;
  if (mode === "test_cases" || intent === "test_cases") return 1100;

  return 700;
}

function estimateMemoryTokens(memoryContext?: AiMemoryContext) {
  if (!memoryContext) return 0;

  const projectDocuments = (memoryContext.projectDocuments || [])
    .map((document) => `${document.title}\n${document.content}`)
    .join("\n");

  return estimateTextTokens(
    [memoryContext.projectInstruction || "", projectDocuments, ...memoryContext.account].join("\n")
  );
}

function sumKnownTokens(inputTokens?: number, outputTokens?: number) {
  if (!inputTokens && !outputTokens) return undefined;

  return (inputTokens || 0) + (outputTokens || 0);
}

function getModelCreditMultiplier(model: string) {
  if (model === "gemini-2.5-flash") return 2;

  return 1;
}

function getTokensPerCredit() {
  return Math.max(1, env.usageTokensPerCredit);
}

function getImageCredits() {
  return Math.max(0, env.usageImageCredits);
}

function getTextFileCredits() {
  return Math.max(0, env.usageTextFileCredits);
}

function getRouterCredits() {
  return Math.max(0, env.usageRouterCredits);
}

function normalizeCredits(credits: number) {
  if (!Number.isFinite(credits)) return 1;

  return Math.max(1, Math.ceil(credits));
}
