import type { AiProviderId } from "./ai.types.js";

export const GEMINI_PROVIDER_ID = "gemini" satisfies AiProviderId;
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export const GEMINI_MODELS = [
  {
    label: "Gemini 2.5 Flash",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "Screenshot review and deeper QA analysis",
    supportsImages: true,
    value: "gemini-2.5-flash",
  },
  {
    label: "Gemini 2.5 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "Fast text tasks",
    supportsImages: true,
    value: "gemini-2.5-flash-lite",
  },
  {
    label: "Gemini 3.1 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "High-volume text tasks",
    supportsImages: true,
    value: "gemini-3.1-flash-lite",
  },
] as const;

export type GeminiModel = (typeof GEMINI_MODELS)[number]["value"];

export function isAllowedGeminiModel(model: string): model is GeminiModel {
  return GEMINI_MODELS.some((option) => option.value === model);
}

export function normalizeGeminiModel(model: string | undefined): GeminiModel {
  return model && isAllowedGeminiModel(model) ? model : GEMINI_DEFAULT_MODEL;
}
