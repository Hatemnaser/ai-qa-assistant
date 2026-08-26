import { isAllowedGeminiModel } from "../../../catalogs/gemini-model-catalog.js";
import type { AppEnv } from "../load.js";

export function validateAiEnv(config: AppEnv) {
  if (config.aiProvider !== "gemini") {
    throw new Error("Unsafe AI configuration: AI_PROVIDER must be gemini.");
  }

  const configuredGeminiModels = [
    ["GEMINI_MODEL", config.geminiModel],
    ["AI_WORKFLOW_ROUTER_MODEL", config.aiWorkflowRouterModel],
    ["AI_SUMMARY_MODEL", config.aiSummaryModel],
    ["AI_GENERAL_MODEL", config.aiGeneralModel],
    ["AI_VISUAL_MODEL", config.aiVisualModel],
    ["AI_FALLBACK_MODEL", config.aiFallbackModel],
  ] as const;

  for (const [name, model] of configuredGeminiModels) {
    if (model && !isAllowedGeminiModel(model)) {
      throw new Error(`Unsafe AI configuration: ${name} contains an unsupported Gemini model.`);
    }
  }

  if (config.guestAiEnabled && !config.aiEnabled) {
    throw new Error("Unsafe AI configuration: GUEST_AI_ENABLED requires AI_ENABLED=true.");
  }
}

export function validateProductionAiEnv(config: AppEnv) {
  if (config.aiEnabled && !config.geminiApiKey.trim()) {
    throw new Error(
      "Unsafe production AI configuration: GEMINI_API_KEY is required when AI_ENABLED=true."
    );
  }

  if (config.aiEnabled && !config.geminiPaidServiceConfirmed) {
    throw new Error(
      "Unsafe production AI configuration: GEMINI_PAID_SERVICE_CONFIRMED=true is required when AI_ENABLED=true."
    );
  }
}
