import type { AiHistoryMessage } from "../ai.types.js";
import {
  analyzeQaWorkflow,
  createQaWorkflowAnalysis,
  type QaWorkflowAnalysis,
  type QaWorkflowInput,
  type QaWorkflowIntent,
  type QaWorkflowLanguage,
} from "../qa-workflow.js";

const allowedIntents = new Set<QaWorkflowIntent>([
  "bug_report",
  "checklist",
  "clarification",
  "conversational",
  "edge_cases",
  "file_context",
  "general_qa",
  "language_preference",
  "screenshot_review",
  "test_cases",
  "visual_context",
]);

const allowedLanguages = new Set<QaWorkflowLanguage>(["arabic", "english", "mixed", "unknown"]);

export interface WorkflowRouterInput extends QaWorkflowInput {
  localAnalysis: QaWorkflowAnalysis;
}

export interface WorkflowRouterDecision {
  confidence?: number;
  intent?: string;
  language?: string;
  reason?: string;
  targetModel?: string;
}

export type WorkflowRouter = (input: WorkflowRouterInput) => Promise<WorkflowRouterDecision | undefined>;

export interface WorkflowRouterOptions {
  enabled?: boolean;
  minConfidence?: number;
  router?: WorkflowRouter;
}

export async function analyzeQaWorkflowWithRouter(
  input: QaWorkflowInput,
  options: WorkflowRouterOptions = {}
) {
  const localAnalysis = analyzeQaWorkflow(input);

  if (!options.enabled || !options.router || !shouldUseAiWorkflowRouter(input, localAnalysis)) {
    return localAnalysis;
  }

  try {
    const decision = await options.router({
      ...input,
      localAnalysis,
    });

    return mergeRouterDecision(input, localAnalysis, decision, options.minConfidence);
  } catch {
    return localAnalysis;
  }
}

export function shouldUseAiWorkflowRouter(input: QaWorkflowInput, localAnalysis: QaWorkflowAnalysis) {
  const message = input.message.trim();

  if (!message) return false;
  if (localAnalysis.language === "arabic" || localAnalysis.language === "mixed") return true;
  if (localAnalysis.confidence < 0.72) return true;
  if (localAnalysis.source === "fallback" || localAnalysis.source === "selected_mode") return true;

  return false;
}

export function mergeRouterDecision(
  input: QaWorkflowInput,
  localAnalysis: QaWorkflowAnalysis,
  decision: WorkflowRouterDecision | undefined,
  minConfidence = 0.72
): QaWorkflowAnalysis {
  if (!decision) return localAnalysis;

  const confidence = normalizeConfidence(decision.confidence);

  if (confidence < minConfidence) return localAnalysis;

  const intent = normalizeIntent(decision.intent);

  if (!intent) return localAnalysis;

  return createQaWorkflowAnalysis({
    confidence,
    intent,
    language: normalizeLanguage(decision.language) || localAnalysis.language,
    message: input.message.trim(),
    mode: input.mode,
    source: "ai_router",
  });
}

export function buildWorkflowRouterPrompt(input: WorkflowRouterInput) {
  const history = formatRouterHistory(input.history || []);

  return `You are a workflow router for an AI QA Assistant.

Classify the latest user message using conversation context, selected UI mode, and attachment flags.
Return JSON only. Do not answer the user.

Allowed intents:
- general_qa: general QA help or a new general question
- test_cases: user wants test cases/scenarios
- bug_report: user wants a bug/defect report
- edge_cases: user wants edge/corner/negative cases
- checklist: user wants a QA checklist
- screenshot_review: user wants a visual QA review
- visual_context: user attached an image but did not ask for a specific artifact
- file_context: user attached text/data files but did not ask for a specific artifact
- conversational: thanks, greetings, reactions, short social follow-up
- clarification: user asks to explain/clarify previous answer
- language_preference: user asks to switch/respond in a language

Routing rules:
- The latest user message is the strongest signal.
- Do not keep an artifact mode just because the UI mode is selected.
- If the user asks to shorten, refine, translate, or adjust the previous artifact, classify as clarification unless they ask for a new artifact.
- If the user says thanks, ok, wow, or a similar reaction in any language, classify as conversational unless a new attachment clearly needs context handling.
- If hasImage is true and the user does not ask for a specific artifact, classify as visual_context.
- If hasTextAttachment is true and the user does not ask for a specific artifact, classify as file_context.
- Detect the language from the latest message, not only from older context.

Selected UI mode: ${input.mode}
Has image attachment: ${Boolean(input.hasImage)}
Has text/data attachment: ${Boolean(input.hasTextAttachment)}

Local fallback guess:
${JSON.stringify(
  {
    confidence: input.localAnalysis.confidence,
    effectiveMode: input.localAnalysis.effectiveMode,
    intent: input.localAnalysis.intent,
    language: input.localAnalysis.language,
    source: input.localAnalysis.source,
  },
  null,
  2
)}

Recent context:
${history || "None"}

Latest user message:
${input.message}

Return exactly this JSON shape:
{
  "intent": "one allowed intent",
  "language": "arabic | english | mixed | unknown",
  "confidence": 0.0,
  "targetModel": "optional model value",
  "reason": "short internal reason"
}`;
}

function normalizeIntent(intent: string | undefined): QaWorkflowIntent | undefined {
  if (!intent) return undefined;

  const normalized = intent.trim() as QaWorkflowIntent;

  return allowedIntents.has(normalized) ? normalized : undefined;
}

function normalizeLanguage(language: string | undefined): QaWorkflowLanguage | undefined {
  if (!language) return undefined;

  const normalized = language.trim() as QaWorkflowLanguage;

  return allowedLanguages.has(normalized) ? normalized : undefined;
}

function normalizeConfidence(confidence: number | undefined) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0;

  return Math.max(0, Math.min(1, confidence));
}

function formatRouterHistory(history: AiHistoryMessage[]) {
  return history
    .filter((item) => item.content.trim())
    .slice(-6)
    .map((item) => {
      const role = item.role === "assistant" ? "Assistant" : "User";
      const content = truncate(item.content.replace(/\s+/g, " "), 700);

      return `${role}${item.mode ? ` [${item.mode}]` : ""}: ${content}`;
    })
    .join("\n");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 3)}...`;
}
