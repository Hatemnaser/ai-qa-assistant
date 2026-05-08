export const STORAGE_KEYS = {
  CHATS: "ai_qa_assistant_chats",
  ACTIVE_CHAT_ID: "ai_qa_assistant_active_chat_id",
  THEME: "ai_qa_assistant_theme",
};

export const DEFAULT_MODE = "general";
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
export const SCREENSHOT_REVIEW_MODEL = "gemini-2.5-flash";

export const GEMINI_MODELS = [
  {
    label: "Gemini 3.1 Flash Lite",
    value: "gemini-3.1-flash-lite",
    supportsImages: true,
    recommendedFor: "High-volume text tasks",
  },
  {
    label: "Gemini 2.5 Flash",
    value: "gemini-2.5-flash",
    supportsImages: true,
    recommendedFor: "Screenshot review and deeper QA analysis",
  },
  {
    label: "Gemini 2.5 Flash Lite",
    value: "gemini-2.5-flash-lite",
    supportsImages: true,
    recommendedFor: "Fast text tasks",
  },
];

export function getModelConfig(model) {
  return (
    GEMINI_MODELS.find((option) => option.value === model) ||
    GEMINI_MODELS.find((option) => option.value === DEFAULT_MODEL)
  );
}

export function normalizeModel(model) {
  const selectedModel = typeof model === "string" ? model.trim() : "";
  return getModelConfig(selectedModel)?.value || DEFAULT_MODEL;
}

export function supportsImages(model) {
  return getModelConfig(model)?.supportsImages !== false;
}
