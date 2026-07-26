import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import {
  accountImportService,
  type AccountImportService,
} from "./account-import.service.js";

export function createAccountImportController(service: AccountImportService) {
  return {
    async preview(req: Request, res: Response, next: NextFunction) {
      try {
        assertZipPayload(req);
        const result = await service.preview(req.body);

        setPrivateResponseHeaders(res);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },

    async commit(req: Request, res: Response, next: NextFunction) {
      try {
        assertZipPayload(req);
        const digest = req.get("x-package-digest");

        if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
          throw new AppError(
            "A valid preview package digest is required.",
            400,
            "ACCOUNT_IMPORT_DIGEST_REQUIRED"
          );
        }

        const result = await service.commit(
          req.authUser!.id,
          req.body,
          digest
        );

        setPrivateResponseHeaders(res);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  };
}

function assertZipPayload(req: Request) {
  if (!req.is("application/zip")) {
    throw new AppError(
      "Account import requires a ZIP payload.",
      415,
      "ACCOUNT_IMPORT_CONTENT_TYPE_UNSUPPORTED"
    );
  }

  if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
    throw new AppError(
      "Account import file is invalid or unsupported.",
      400,
      "ACCOUNT_IMPORT_PACKAGE_INVALID"
    );
  }
}

function setPrivateResponseHeaders(res: Response) {
  res.set({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

export const { commit: commitAccountImport, preview: previewAccountImport } =
  createAccountImportController(accountImportService);
