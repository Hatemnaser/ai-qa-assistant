import type { NextFunction, Request, Response } from "express";

import { updateSettingsSchema } from "./settings.schema.js";
import { settingsService } from "./settings.service.js";

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.getUserSettings(req.authUser!.id);

    res.json({
      settings,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.updateUserSettings(
      req.authUser!.id,
      updateSettingsSchema.parse(req.body)
    );

    res.json({
      settings,
    });
  } catch (error) {
    next(error);
  }
}
