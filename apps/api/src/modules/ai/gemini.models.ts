import type { AiProviderId } from "./ai.types.js";

export const GEMINI_PROVIDER_ID = "gemini" satisfies AiProviderId;
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

const GEMINI_INLINE_ATTACHMENT_CAPABILITIES = {
  images: true,
  text: true,
  textAttachments: true,
} as const;

export const GEMINI_MODELS = [
  {
    capabilities: GEMINI_INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 2.5 Flash",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "Visual review and deeper QA analysis",
    value: "gemini-2.5-flash",
  },
  {
    capabilities: GEMINI_INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 2.5 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "Fast text tasks",
    value: "gemini-2.5-flash-lite",
  },
  {
    capabilities: GEMINI_INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 3.1 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "High-volume text tasks",
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
