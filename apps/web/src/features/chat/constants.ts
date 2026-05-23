export const STORAGE_KEYS = {
  CHATS: "ai_qa_assistant_chats",
  ACTIVE_CHAT_ID: "ai_qa_assistant_active_chat_id",
  THEME: "ai_qa_assistant_theme",
};

export const DEFAULT_MODE = "general";
export const DEFAULT_MODEL = "gemini-2.5-flash";
export const SCREENSHOT_REVIEW_MODEL = "gemini-2.5-flash";

export const QA_MODES = [
  { label: "General QA", value: "general" },
  { label: "Test Cases", value: "test_cases" },
  { label: "Bug Report", value: "bug_report" },
  { label: "Edge Cases", value: "edge_cases" },
  { label: "QA Checklist", value: "checklist" },
  { label: "Screenshot Review", value: "screenshot_review" },
] as const;

export const COMPOSER_PLACEHOLDERS_BY_MODE: Record<string, string> = {
  general: "Ask about QA strategy, risks, or testing ideas...",
  test_cases: "Describe the feature or requirement to test...",
  bug_report: "Describe the issue, actual result, and expected result...",
  edge_cases: "Describe the feature and I will look for edge cases...",
  checklist: "Describe the product, feature, or release scope...",
  screenshot_review: "Add notes about what to inspect in the screenshot...",
};

export const AI_MODELS = [
  {
    label: "Gemini 2.5 Flash",
    provider: "gemini",
    value: "gemini-2.5-flash",
    supportsImages: true,
    recommendedFor: "Screenshot review and deeper QA analysis",
  },
  {
    label: "Gemini 2.5 Flash Lite",
    provider: "gemini",
    value: "gemini-2.5-flash-lite",
    supportsImages: true,
    recommendedFor: "Fast text tasks",
  },
  {
    label: "Gemini 3.1 Flash Lite",
    provider: "gemini",
    value: "gemini-3.1-flash-lite",
    supportsImages: true,
    recommendedFor: "High-volume text tasks",
  },
] as const;

type AiModel = (typeof AI_MODELS)[number];

export function getModelConfig(model: unknown): AiModel {
  const selectedModel = typeof model === "string" ? model.trim() : "";

  return (
    AI_MODELS.find((option) => option.value === selectedModel) ||
    AI_MODELS.find((option) => option.value === DEFAULT_MODEL) ||
    AI_MODELS[0]
  );
}

export function normalizeModel(model: unknown) {
  return getModelConfig(model).value;
}

export function supportsImages(model: unknown) {
  return getModelConfig(model).supportsImages;
}

export function getModelForMode(mode: string, requestedModel: unknown) {
  const selectedModel = normalizeModel(requestedModel);

  if (mode === "screenshot_review" && !supportsImages(selectedModel)) {
    return SCREENSHOT_REVIEW_MODEL;
  }

  return selectedModel;
}

export function getModelHint(model: unknown, mode: string) {
  const selectedConfig = getModelConfig(model);
  const screenshotRecommendation =
    mode === "screenshot_review" ? ` Screenshot review is best with ${SCREENSHOT_REVIEW_MODEL}.` : "";

  return `${selectedConfig.label}: ${selectedConfig.recommendedFor}.${screenshotRecommendation}`;
}

export const QUICK_ACTIONS = [
  {
    label: "Test Cases",
    mode: "test_cases",
    prompt: "Generate test cases for a login page",
  },
  {
    label: "Bug Report",
    mode: "bug_report",
    prompt: "Create a structured bug report for: login button does not work",
  },
  {
    label: "Edge Cases",
    mode: "edge_cases",
    prompt: "Suggest edge cases for a checkout page",
  },
  {
    label: "QA Checklist",
    mode: "checklist",
    prompt: "Create a QA checklist for a web application",
  },
  {
    label: "Screenshot Review",
    mode: "screenshot_review",
    prompt: "Analyze this screenshot as a QA engineer",
  },
] as const;

export type QuickAction = (typeof QUICK_ACTIONS)[number];
