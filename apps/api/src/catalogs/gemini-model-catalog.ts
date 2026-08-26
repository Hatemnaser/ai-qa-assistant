export const GEMINI_PROVIDER_ID = "gemini";
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

export const GEMINI_MODEL_IDS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export type GeminiModel = (typeof GEMINI_MODEL_IDS)[number];

export function isAllowedGeminiModel(model: string): model is GeminiModel {
  return GEMINI_MODEL_IDS.some((allowedModel) => allowedModel === model);
}
