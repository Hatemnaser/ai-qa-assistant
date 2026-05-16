export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export const GEMINI_ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export type GeminiModel = (typeof GEMINI_ALLOWED_MODELS)[number];

export function isAllowedGeminiModel(model: string): model is GeminiModel {
  return GEMINI_ALLOWED_MODELS.includes(model as GeminiModel);
}

export function normalizeGeminiModel(model: string | undefined): GeminiModel {
  return model && isAllowedGeminiModel(model) ? model : GEMINI_DEFAULT_MODEL;
}
