import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { cancelAsset, completeAsset, getAssetDownload, initiateAsset } from "./assets.controller.js";
import { assetInitiateRateLimit } from "./assets.rateLimit.js";

export const assetsRouter = Router();

assetsRouter.use(requireAuth);
assetsRouter.post("/initiate", assetInitiateRateLimit, initiateAsset);
assetsRouter.post("/:assetId/complete", completeAsset);
assetsRouter.get("/:assetId/download", getAssetDownload);
assetsRouter.delete("/:assetId", cancelAsset);
