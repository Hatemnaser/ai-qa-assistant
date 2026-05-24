import type { Request, Response } from "express";

import {
  FALLBACK_AI_MODEL,
  FALLBACK_AI_PROVIDER,
  getAiModelCatalog,
  getAllowedProviderIds,
} from "./provider-registry.js";

export function listAiModels(_req: Request, res: Response) {
  res.json({
    defaultModel: FALLBACK_AI_MODEL,
    defaultProvider: FALLBACK_AI_PROVIDER,
    models: getAiModelCatalog(),
    providers: getAllowedProviderIds(),
  });
}
