import type { QaWorkflowIntent, QaWorkflowSource } from "../../qa-workflow.js";

interface QaWorkflowDetectionContext {
  hasImage: boolean;
  hasTextAttachment: boolean;
  message: string;
  mode: string;
}

export interface LocalWorkflowIntentDetection {
  confidence: number;
  intent: QaWorkflowIntent;
  source: QaWorkflowSource;
}

type IntentRule = (context: QaWorkflowDetectionContext) => LocalWorkflowIntentDetection | undefined;

const artifactIntents = new Set<QaWorkflowIntent>([
  "bug_report",
  "checklist",
  "edge_cases",
  "screenshot_review",
  "test_cases",
]);

export function isArtifactWorkflowIntent(intent: string): intent is QaWorkflowIntent {
  return artifactIntents.has(intent as QaWorkflowIntent);
}

export function detectLocalWorkflowIntent(input: QaWorkflowDetectionContext): LocalWorkflowIntentDetection {
  const context = {
    ...input,
    message: input.message.trim().toLowerCase(),
  };

  for (const rule of intentRules) {
    const detection = rule(context);

    if (detection) return detection;
  }

  return {
    confidence: 0.4,
    intent: "general_qa",
    source: "fallback",
  };
}

const intentRules: IntentRule[] = [
  ({ message }) => matchPatternIntent(message, languagePreferencePatterns, "language_preference"),
  ({ message }) => matchPatternIntent(message, bugReportPatterns, "bug_report"),
  ({ message }) => matchPatternIntent(message, checklistPatterns, "checklist"),
  ({ message }) => matchPatternIntent(message, edgeCasePatterns, "edge_cases"),
  ({ message }) => matchPatternIntent(message, testCasePatterns, "test_cases"),
  ({ hasTextAttachment, mode }) =>
    hasTextAttachment && mode === "screenshot_review" ? localIntent("file_context") : undefined,
  ({ hasTextAttachment, mode }) =>
    hasTextAttachment ? modeFallbackIntent(getArtifactModeIntent(mode)) : undefined,
  ({ hasTextAttachment, message }) =>
    hasTextAttachment && isWeakFileContextRequest(message) ? localIntent("file_context") : undefined,
  ({ hasImage, mode }) =>
    hasImage && mode !== "screenshot_review" ? modeFallbackIntent(getArtifactModeIntent(mode)) : undefined,
  ({ hasImage, message }) =>
    hasImage && isWeakVisualContextRequest(message) ? localIntent("visual_context") : undefined,
  ({ hasImage }) => (hasImage ? localIntent("screenshot_review") : undefined),
  ({ message }) => matchPatternIntent(message, conversationalPatterns, "conversational"),
  ({ message }) => matchPatternIntent(message, clarificationPatterns, "clarification"),
  ({ mode }) => modeFallbackIntent(getArtifactModeIntent(mode)),
];

function getArtifactModeIntent(mode: string) {
  return isArtifactWorkflowIntent(mode) ? (mode as QaWorkflowIntent) : undefined;
}

function matchPatternIntent(message: string, patterns: RegExp[], intent: QaWorkflowIntent) {
  return matchesAny(message, patterns) ? localIntent(intent) : undefined;
}

function localIntent(intent: QaWorkflowIntent): LocalWorkflowIntentDetection {
  return {
    confidence: getLocalIntentConfidence(intent),
    intent,
    source: "local_rule",
  };
}

function modeFallbackIntent(intent: QaWorkflowIntent | undefined): LocalWorkflowIntentDetection | undefined {
  if (!intent) return undefined;

  return {
    confidence: 0.5,
    intent,
    source: "selected_mode",
  };
}

function getLocalIntentConfidence(intent: QaWorkflowIntent) {
  if (intent === "general_qa") return 0.4;
  if (intent === "visual_context" || intent === "file_context") return 0.86;
  if (intent === "screenshot_review") return 0.86;

  return 0.9;
}

function isWeakVisualNote(message: string) {
  if (!message) return true;

  return weakVisualNotePatterns.some((pattern) => pattern.test(message));
}

function isWeakVisualContextRequest(message: string) {
  return (
    isWeakVisualNote(message) ||
    matchesAny(message, conversationalPatterns) ||
    matchesAny(message, clarificationPatterns)
  );
}

function isWeakFileNote(message: string) {
  if (!message) return true;

  return weakFileNotePatterns.some((pattern) => pattern.test(message));
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

const conversationalPatterns = [
  /^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|perfect|awesome|done|wow|waw|lol|haha)[.!?]*$/,
];

const languagePreferencePatterns = [
  /\b(can|could|do)\s+you\s+(speak|talk|write|answer|reply)\s+(in\s+)?(arabic|english)\b/,
  /\b(use|switch to|respond in|reply in|answer in|write in)\s+(arabic|english)\b/,
  /\b(in arabic|in english|arabic please|english please)\b/,
];

const clarificationPatterns = [
  /\b(what do you mean|can you explain|explain this|why|how so|what next)\b/,
];

const testCasePatterns = [
  /\b(test cases?|test scenarios?|test suites?|cases?)\b/,
  /\b(create|generate|write|design|list|give me|make)\s+(manual\s+)?tests?\b/,
];

const bugReportPatterns = [
  /\b(bug report|defect report|issue report|repro steps|actual result|expected result)\b/,
];

const checklistPatterns = [
  /\b(checklist|check list|qa checklist|testing checklist)\b/,
];

const edgeCasePatterns = [
  /\b(edge cases?|corner cases?|boundary cases?|negative scenarios?)\b/,
];

const weakVisualNotePatterns = [
  /^(uploaded|attached|sent|added)\s+(an?\s+)?(image|screenshot|picture|photo|attachment)(\s+without\s+additional\s+instructions)?[.!?]*$/,
  /^(image|screenshot|picture|photo|attachment)[.!?]*$/,
  /^(check this|look at this|see this|take a look|here|this)[.!?]*$/,
];

const weakFileNotePatterns = [
  /^(uploaded|attached|sent|added)\s+(\d+\s+)?(files?|attachments?|documents?|text files?|data files?)(\s+without\s+additional\s+instructions)?[.!?]*$/,
  /^(files?|attachments?|documents?|text|csv|json|markdown|log)[.!?]*$/,
  /^(check this|look at this|see this|take a look|here|this)[.!?]*$/,
];
