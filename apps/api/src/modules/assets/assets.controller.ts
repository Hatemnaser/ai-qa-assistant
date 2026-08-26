import type { NextFunction, Request, Response } from "express";

import { assetIdParamsSchema, completeAssetSchema, initiateAssetSchema } from "./assets.schema.js";
import { assetsService } from "./assets.service.js";

export async function initiateAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const response = await assetsService.initiateUpload(req.authUser!.id, initiateAssetSchema.parse(req.body));
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}
export async function completeAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const { assetId } = assetIdParamsSchema.parse(req.params);
    const asset = await assetsService.completeUpload(req.authUser!.id, assetId, completeAssetSchema.parse(req.body));
    res.json({ asset });
  } catch (error) {
    next(error);
  }
}

export async function getAssetDownload(req: Request, res: Response, next: NextFunction) {
  try {
    const { assetId } = assetIdParamsSchema.parse(req.params);
    res.json(await assetsService.getDownloadUrl(req.authUser!.id, assetId));
  } catch (error) {
    next(error);
  }
}

export async function cancelAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const { assetId } = assetIdParamsSchema.parse(req.params);
    res.json(await assetsService.cancelUpload(req.authUser!.id, assetId));
  } catch (error) {
    next(error);
  }
}
