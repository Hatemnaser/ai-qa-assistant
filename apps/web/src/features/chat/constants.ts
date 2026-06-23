import type { AiModelOption } from "./types";
import type { TranslationKey } from "../../i18n/messages";

export const STORAGE_KEYS = {
  CHATS: "ai_qa_assistant_chats",
  ACTIVE_CHAT_ID: "ai_qa_assistant_active_chat_id",
  THEME: "ai_qa_assistant_theme",
};

export const DEFAULT_MODE = "general";
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
export const VISUAL_REVIEW_MODEL = "gemini-2.5-flash";

export const QA_MODES = [
  { label: "General QA", labelKey: "chat.mode.general", value: "general" },
  { label: "Test Cases", labelKey: "chat.mode.testCases", value: "test_cases" },
  { label: "Bug Report", labelKey: "chat.mode.bugReport", value: "bug_report" },
  { label: "Edge Cases", labelKey: "chat.mode.edgeCases", value: "edge_cases" },
  { label: "QA Checklist", labelKey: "chat.mode.checklist", value: "checklist" },
  { label: "Visual Review", labelKey: "chat.mode.visualReview", value: "screenshot_review" },
] as const;

export const COMPOSER_PLACEHOLDERS_BY_MODE: Record<string, string> = {
  general: "Ask about QA strategy, risks, or testing ideas...",
  test_cases: "Describe the feature or requirement to test...",
  bug_report: "Describe the issue, actual result, and expected result...",
  edge_cases: "Describe the feature and I will look for edge cases...",
  checklist: "Describe the product, feature, or release scope...",
  screenshot_review: "Add notes about what to inspect in the visual...",
};

export const COMPOSER_PLACEHOLDER_KEYS_BY_MODE: Record<string, TranslationKey> = {
  bug_report: "chat.composer.placeholder.bugReport",
  checklist: "chat.composer.placeholder.checklist",
  edge_cases: "chat.composer.placeholder.edgeCases",
  general: "chat.composer.placeholder.general",
  screenshot_review: "chat.composer.placeholder.visualReview",
  test_cases: "chat.composer.placeholder.testCases",
};

const INLINE_ATTACHMENT_CAPABILITIES = {
  images: true,
  text: true,
  textAttachments: true,
} as const;

export const AI_MODELS = [
  {
    capabilities: INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 2.5 Flash",
    provider: "gemini",
    value: "gemini-2.5-flash",
    recommendedFor: "Visual review and deeper QA analysis",
  },
  {
    capabilities: INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 2.5 Flash Lite",
    provider: "gemini",
    value: "gemini-2.5-flash-lite",
    recommendedFor: "Fast text tasks",
  },
  {
    capabilities: INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 3.1 Flash Lite",
    provider: "gemini",
    value: "gemini-3.1-flash-lite",
    recommendedFor: "High-volume text tasks",
  },
] as const satisfies readonly AiModelOption[];

type AiModel = AiModelOption;

export function getModelConfig(model: unknown, modelOptions: readonly AiModelOption[] = AI_MODELS): AiModel {
  const selectedModel = typeof model === "string" ? model.trim() : "";

  return (
    modelOptions.find((option) => option.value === selectedModel) ||
    modelOptions.find((option) => option.value === DEFAULT_MODEL) ||
    AI_MODELS[0]
  );
}

export function normalizeModel(model: unknown, modelOptions: readonly AiModelOption[] = AI_MODELS) {
  return getModelConfig(model, modelOptions).value;
}

export function supportsImages(model: unknown, modelOptions: readonly AiModelOption[] = AI_MODELS) {
  return getModelConfig(model, modelOptions).capabilities.images;
}

export function supportsTextAttachments(model: unknown, modelOptions: readonly AiModelOption[] = AI_MODELS) {
  return getModelConfig(model, modelOptions).capabilities.textAttachments;
}

export function getModelForMode(
  mode: string,
  requestedModel: unknown,
  modelOptions: readonly AiModelOption[] = AI_MODELS
) {
  const selectedModel = normalizeModel(requestedModel, modelOptions);

  if (mode === "screenshot_review") {
    return VISUAL_REVIEW_MODEL;
  }

  return selectedModel;
}

export function getModelHint(
  model: unknown,
  mode: string,
  modelOptions: readonly AiModelOption[] = AI_MODELS
) {
  const selectedConfig = getModelConfig(model, modelOptions);
  const visualRecommendation =
    mode === "screenshot_review" ? ` Visual review is best with ${VISUAL_REVIEW_MODEL}.` : "";

  return `${selectedConfig.label}: ${selectedConfig.recommendedFor}.${visualRecommendation}`;
}

export const MODEL_RECOMMENDATION_KEYS_BY_VALUE: Record<string, TranslationKey> = {
  "gemini-2.5-flash": "model.gemini25Flash.recommended",
  "gemini-2.5-flash-lite": "model.gemini25FlashLite.recommended",
  "gemini-3.1-flash-lite": "model.gemini31FlashLite.recommended",
};

export const QUICK_ACTIONS = [
  {
    label: "Test Cases",
    labelKey: "chat.mode.testCases",
    mode: "test_cases",
    prompt: "Generate test cases for a login page",
    promptKey: "chat.quickAction.testCasesPrompt",
  },
  {
    label: "Bug Report",
    labelKey: "chat.mode.bugReport",
    mode: "bug_report",
    prompt: "Create a structured bug report for: login button does not work",
    promptKey: "chat.quickAction.bugReportPrompt",
  },
  {
    label: "Edge Cases",
    labelKey: "chat.mode.edgeCases",
    mode: "edge_cases",
    prompt: "Suggest edge cases for a checkout page",
    promptKey: "chat.quickAction.edgeCasesPrompt",
  },
  {
    label: "QA Checklist",
    labelKey: "chat.mode.checklist",
    mode: "checklist",
    prompt: "Create a QA checklist for a web application",
    promptKey: "chat.quickAction.checklistPrompt",
  },
  {
    label: "Visual Review",
    labelKey: "chat.mode.visualReview",
    mode: "screenshot_review",
    prompt: "Review this visual as a QA engineer",
    promptKey: "chat.quickAction.visualReviewPrompt",
  },
] as const;

export type QuickAction = (typeof QUICK_ACTIONS)[number];
