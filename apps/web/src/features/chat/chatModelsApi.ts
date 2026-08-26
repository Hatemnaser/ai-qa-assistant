import { API_BASE_URL } from "../../config/api";
import { AI_MODELS } from "./constants";
import type { AiModelCatalogResponse, AiModelOption } from "./types";

export async function fetchAiModelCatalog(): Promise<AiModelOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/ai/models`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load AI model catalog.");
  }

  const body = (await response.json()) as Partial<AiModelCatalogResponse>;
  const models = Array.isArray(body.models) ? body.models.filter(isAiModelOption) : [];

  return models.length > 0 ? models : [...AI_MODELS];
}

function isAiModelOption(value: unknown): value is AiModelOption {
  if (!value || typeof value !== "object") return false;

  const option = value as Partial<AiModelOption>;

  return (
    typeof option.label === "string" &&
    typeof option.provider === "string" &&
    typeof option.recommendedFor === "string" &&
    typeof option.value === "string" &&
    Boolean(option.capabilities) &&
    typeof option.capabilities?.images === "boolean" &&
    typeof option.capabilities.text === "boolean" &&
    typeof option.capabilities.textAttachments === "boolean"
  );
}
