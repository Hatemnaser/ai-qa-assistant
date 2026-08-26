import {
  detectLocalWorkflowIntent,
  isArtifactWorkflowIntent,
} from "./routing/rules/workflow-rules.js";
import type {
  QaWorkflowAnalysis,
  QaWorkflowInput,
  QaWorkflowIntent,
  QaWorkflowLanguage,
  QaWorkflowSource,
} from "./qa-workflow.types.js";

export type {
  QaWorkflowAnalysis,
  QaWorkflowInput,
  QaWorkflowIntent,
  QaWorkflowLanguage,
  QaWorkflowSource,
} from "./qa-workflow.types.js";

export function analyzeQaWorkflow({
  hasImage = false,
  hasTextAttachment = false,
  message,
  mode,
}: QaWorkflowInput): QaWorkflowAnalysis {
  const trimmedMessage = message.trim();
  const language = detectLanguage(trimmedMessage);
  const detection = detectLocalWorkflowIntent({
    hasImage,
    hasTextAttachment,
    message: trimmedMessage,
    mode,
  });

  return createQaWorkflowAnalysis({
    confidence: detection.confidence,
    intent: detection.intent,
    language,
    message: trimmedMessage,
    mode,
    source: detection.source,
  });
}

export function createQaWorkflowAnalysis(input: {
  confidence: number;
  intent: QaWorkflowIntent;
  language: QaWorkflowLanguage;
  message: string;
  mode: string;
  source: QaWorkflowSource;
}): QaWorkflowAnalysis {
  const shouldUseArtifactTemplate = isArtifactWorkflowIntent(input.intent) && input.intent !== "clarification";
  const effectiveMode = getEffectiveMode(input.intent, input.mode);

  return {
    confidence: input.confidence,
    effectiveMode,
    intent: input.intent,
    language: input.language,
    shouldAskClarifyingQuestion: shouldUseArtifactTemplate && isUnderspecifiedArtifactRequest(input.message),
    shouldUseArtifactTemplate,
    source: input.source,
  };
}

export function formatWorkflowInstructions(analysis: QaWorkflowAnalysis) {
  return `
## QA Workflow Policy
- Detected intent: ${analysis.intent}.
- Response language: ${formatLanguageInstruction(analysis.language)}
- Treat the latest user message as the strongest signal. Recent context helps, but it must not override the latest request.
- If the user is saying thanks, asking for a language change, asking a clarification question, or making a short conversational follow-up, answer naturally. Do not generate a test artifact.
- If the user asks for a QA artifact, produce a practical QA artifact with explicit assumptions when details are missing.
- If requirements are ambiguous, ask up to 3 focused clarifying questions before inventing business rules.
- Keep QA output useful: cover happy path, negative path, edge cases, data validation, UX/accessibility, security, integrations, and regression risk where relevant.
`;
}

function getEffectiveMode(intent: QaWorkflowIntent, selectedMode: string) {
  if (intent === "conversational" || intent === "language_preference" || intent === "clarification") {
    return "general";
  }

  if (intent === "file_context" || intent === "visual_context") {
    return "general";
  }

  if (isArtifactWorkflowIntent(intent)) {
    return intent;
  }

  return selectedMode || "general";
}

function detectLanguage(message: string): QaWorkflowLanguage {
  const hasArabic = /[\u0600-\u06ff]/.test(message);
  const hasLatin = /[a-z]/i.test(message);

  if (hasArabic && hasLatin) return "mixed";
  if (hasArabic) return "arabic";
  if (hasLatin) return "english";

  return "unknown";
}

function isUnderspecifiedArtifactRequest(message: string) {
  const words = message
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.length <= 2;
}

function formatLanguageInstruction(language: QaWorkflowLanguage) {
  if (language === "arabic") return "Arabic.";
  if (language === "english") return "English.";
  if (language === "mixed") return "Use the user's dominant language and preserve useful technical terms.";

  return "Use the language of the user's latest message when clear.";
}
