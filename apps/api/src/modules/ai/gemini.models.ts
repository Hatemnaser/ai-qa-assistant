import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_IDS,
  GEMINI_PROVIDER_ID,
  isAllowedGeminiModel,
  type GeminiModel,
} from "../../catalogs/gemini-model-catalog.js";

export {
  GEMINI_DEFAULT_MODEL,
  GEMINI_PROVIDER_ID,
  isAllowedGeminiModel,
  type GeminiModel,
} from "../../catalogs/gemini-model-catalog.js";

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
    value: GEMINI_MODEL_IDS[0],
  },
  {
    capabilities: GEMINI_INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 2.5 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "Fast text tasks",
    value: GEMINI_MODEL_IDS[1],
  },
  {
    capabilities: GEMINI_INLINE_ATTACHMENT_CAPABILITIES,
    label: "Gemini 3.1 Flash Lite",
    provider: GEMINI_PROVIDER_ID,
    recommendedFor: "High-volume text tasks",
    value: GEMINI_MODEL_IDS[2],
  },
] as const;

export function normalizeGeminiModel(model: string | undefined): GeminiModel {
  return model && isAllowedGeminiModel(model) ? model : GEMINI_DEFAULT_MODEL;
}
