import type { NextFunction, Request, Response } from "express";

import {
  accountDataPortabilityService,
  type AccountDataPortabilityService,
} from "./account-data-portability.service.js";

export function createAccountDataPortabilityController(
  service: AccountDataPortabilityService
) {
  return {
    async exportAccountData(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.exportAccountData(req.authUser!.id);

        res.set({
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${result.downloadFilename}"`,
          "Content-Length": String(result.archive.byteLength),
          "Content-Type": "application/zip",
          "X-Content-Type-Options": "nosniff",
        });
        res.status(200).send(result.archive);
      } catch (error) {
        next(error);
      }
    },
  };
}

export const { exportAccountData } =
  createAccountDataPortabilityController(accountDataPortabilityService);
