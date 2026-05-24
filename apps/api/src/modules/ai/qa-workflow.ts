import type { AiHistoryMessage } from "./ai.types.js";

export type QaWorkflowIntent =
  | "bug_report"
  | "checklist"
  | "clarification"
  | "conversational"
  | "edge_cases"
  | "file_context"
  | "general_qa"
  | "language_preference"
  | "screenshot_review"
  | "test_cases"
  | "visual_context";

export type QaWorkflowLanguage = "arabic" | "english" | "mixed" | "unknown";

export interface QaWorkflowInput {
  hasTextAttachment?: boolean;
  history?: AiHistoryMessage[];
  hasImage?: boolean;
  message: string;
  mode: string;
}

export interface QaWorkflowAnalysis {
  effectiveMode: string;
  intent: QaWorkflowIntent;
  language: QaWorkflowLanguage;
  shouldUseArtifactTemplate: boolean;
  shouldAskClarifyingQuestion: boolean;
}

const artifactIntents = new Set<QaWorkflowIntent>([
  "bug_report",
  "checklist",
  "edge_cases",
  "screenshot_review",
  "test_cases",
]);

interface QaWorkflowDetectionContext {
  hasImage: boolean;
  hasTextAttachment: boolean;
  message: string;
  mode: string;
}

type IntentRule = (context: QaWorkflowDetectionContext) => QaWorkflowIntent | undefined;

export function analyzeQaWorkflow({
  hasImage = false,
  hasTextAttachment = false,
  message,
  mode,
}: QaWorkflowInput): QaWorkflowAnalysis {
  const trimmedMessage = message.trim();
  const normalizedMessage = trimmedMessage.toLowerCase();
  const language = detectLanguage(trimmedMessage);
  const intent = detectIntent(normalizedMessage, mode, hasImage, hasTextAttachment);
  const shouldUseArtifactTemplate = artifactIntents.has(intent) && intent !== "clarification";
  const effectiveMode = getEffectiveMode(intent, mode);

  return {
    effectiveMode,
    intent,
    language,
    shouldAskClarifyingQuestion: shouldUseArtifactTemplate && isUnderspecifiedArtifactRequest(trimmedMessage),
    shouldUseArtifactTemplate,
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

function detectIntent(
  message: string,
  mode: string,
  hasImage: boolean,
  hasTextAttachment: boolean
): QaWorkflowIntent {
  const context = {
    hasImage,
    hasTextAttachment,
    message,
    mode,
  };

  for (const rule of intentRules) {
    const intent = rule(context);

    if (intent) return intent;
  }

  return "general_qa";
}

const intentRules: IntentRule[] = [
  ({ message }) => matchPatternIntent(message, languagePreferencePatterns, "language_preference"),
  ({ message }) => matchPatternIntent(message, bugReportPatterns, "bug_report"),
  ({ message }) => matchPatternIntent(message, checklistPatterns, "checklist"),
  ({ message }) => matchPatternIntent(message, edgeCasePatterns, "edge_cases"),
  ({ message }) => matchPatternIntent(message, testCasePatterns, "test_cases"),
  ({ hasTextAttachment, mode }) =>
    hasTextAttachment && mode === "screenshot_review" ? "file_context" : undefined,
  ({ hasTextAttachment, mode }) => (hasTextAttachment ? getArtifactModeIntent(mode) : undefined),
  ({ hasTextAttachment, message }) =>
    hasTextAttachment && isWeakFileContextRequest(message) ? "file_context" : undefined,
  ({ hasImage, mode }) => (hasImage && mode !== "screenshot_review" ? getArtifactModeIntent(mode) : undefined),
  ({ hasImage, message }) =>
    hasImage && isWeakVisualContextRequest(message) ? "visual_context" : undefined,
  ({ hasImage }) => (hasImage ? "screenshot_review" : undefined),
  ({ message }) => matchPatternIntent(message, conversationalPatterns, "conversational"),
  ({ message }) => matchPatternIntent(message, clarificationPatterns, "clarification"),
  ({ mode }) => getArtifactModeIntent(mode),
];

function getEffectiveMode(intent: QaWorkflowIntent, selectedMode: string) {
  if (intent === "conversational" || intent === "language_preference" || intent === "clarification") {
    return "general";
  }

  if (intent === "file_context" || intent === "visual_context") {
    return "general";
  }

  if (artifactIntents.has(intent)) {
    return intent;
  }

  return selectedMode || "general";
}

function isArtifactMode(mode: string) {
  return artifactIntents.has(mode as QaWorkflowIntent);
}

function getArtifactModeIntent(mode: string) {
  return isArtifactMode(mode) ? (mode as QaWorkflowIntent) : undefined;
}

function matchPatternIntent(message: string, patterns: RegExp[], intent: QaWorkflowIntent) {
  return matchesAny(message, patterns) ? intent : undefined;
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

function isWeakVisualNote(message: string) {
  const normalized = message.trim().toLowerCase();

  if (!normalized) return true;

  return weakVisualNotePatterns.some((pattern) => pattern.test(normalized));
}

function isWeakVisualContextRequest(message: string) {
  return (
    isWeakVisualNote(message) ||
    matchesAny(message, conversationalPatterns) ||
    matchesAny(message, clarificationPatterns)
  );
}

function isWeakFileNote(message: string) {
  const normalized = message.trim().toLowerCase();

  if (!normalized) return true;

  return weakFileNotePatterns.some((pattern) => pattern.test(normalized));
}

function isWeakFileContextRequest(message: string) {
  return (
    isWeakFileNote(message) ||
    matchesAny(message, conversationalPatterns) ||
    matchesAny(message, clarificationPatterns)
  );
}

function matchesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

function formatLanguageInstruction(language: QaWorkflowLanguage) {
  if (language === "arabic") return "Arabic.";
  if (language === "english") return "English.";
  if (language === "mixed") return "Use the user's dominant language and preserve useful technical terms.";

  return "Use the language of the user's latest message when clear.";
}

const conversationalPatterns = [
  /^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|perfect|awesome|done|wow|waw|lol|haha)[.!?]*$/,
  /^(مرحبا|اهلا|أهلا|شكرا|شكراً|تمام|اوكي|حلو|ممتاز|يسلمو|يعطيك العافية|واو|ههه)[.!؟]*$/,
];

const languagePreferencePatterns = [
  /\b(can|could|do)\s+you\s+(speak|talk|write|answer|reply)\s+(in\s+)?(arabic|english)\b/,
  /\b(use|switch to|respond in|reply in|answer in|write in)\s+(arabic|english)\b/,
  /\b(in arabic|in english|arabic please|english please)\b/,
  /(بتحكي|تحكي|احكي|جاوب|اكتب).*(عربي|باللغة العربية|بالانجليزي|انجليزي)/,
];

const clarificationPatterns = [
  /\b(what do you mean|can you explain|explain this|why|how so|what next)\b/,
  /(شو يعني|اشرح|وضح|ليش|كيف يعني|شو الخطوة)/,
];

const testCasePatterns = [
  /\b(test cases?|test scenarios?|test suites?|cases?)\b/,
  /\b(create|generate|write|design|list|give me|make)\s+(manual\s+)?tests?\b/,
  /(تست|تيست|حالات اختبار|اختبارات)/,
];

const bugReportPatterns = [
  /\b(bug report|defect report|issue report|repro steps|actual result|expected result)\b/,
  /(تقرير bug|تقرير باغ|باغ ريبورت|خطوات إعادة|النتيجة الفعلية|النتيجة المتوقعة)/,
];

const checklistPatterns = [
  /\b(checklist|check list|qa checklist|testing checklist)\b/,
  /(تشيك ليست|قائمة فحص|قائمة اختبار)/,
];

const edgeCasePatterns = [
  /\b(edge cases?|corner cases?|boundary cases?|negative scenarios?)\b/,
  /(إيدج|ايدج|حالات حدودية|حالات طرفية|سيناريوهات سلبية)/,
];

const weakVisualNotePatterns = [
  /^(uploaded|attached|sent|added)\s+(an?\s+)?(image|screenshot|picture|photo|attachment)(\s+without\s+additional\s+instructions)?[.!?]*$/,
  /^(image|screenshot|picture|photo|attachment)[.!?]*$/,
  /^(check this|look at this|see this|take a look|here|this)[.!?]*$/,
  /^(شوف|شوف هاي|شوف هاد|هاي|هاد|الصورة|سكرين شوت|صورة)[.!؟]*$/,
];

const weakFileNotePatterns = [
  /^(uploaded|attached|sent|added)\s+(\d+\s+)?(files?|attachments?|documents?|text files?|data files?)(\s+without\s+additional\s+instructions)?[.!?]*$/,
  /^(files?|attachments?|documents?|text|csv|json|markdown|log)[.!?]*$/,
  /^(check this|look at this|see this|take a look|here|this)[.!?]*$/,
  /^(رفعت|ارفقت|بعت)\s+(\d+\s+)?(ملفات?|مرفقات?|داتا|بيانات)[.!؟]*$/,
  /^(ملف|مرفق|مرفقات|بيانات|داتا|هاد|هاي)[.!؟]*$/,
];
