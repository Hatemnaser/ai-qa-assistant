import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { accountMemoryImportDigestSchema } from "./account-memory-portability.schema.js";
import {
  accountMemoryPortabilityService,
  type AccountMemoryPortabilityService,
} from "./account-memory-portability.service.js";

export function createAccountMemoryPortabilityController(
  service: AccountMemoryPortabilityService
) {
  return {
    async commitAccountMemoryImport(
      req: Request,
      res: Response,
      next: NextFunction
    ) {
      try {
        assertJsonPayload(req);
        const digestResult = accountMemoryImportDigestSchema.safeParse(
          req.get("x-package-digest")
        );

        if (!digestResult.success) {
          throw new AppError(
            "A valid preview package digest is required.",
            400,
            "ACCOUNT_MEMORY_IMPORT_DIGEST_REQUIRED"
          );
        }

        const result = await service.commitAccountMemoryImport(
          req.authUser!.id,
          req.body,
          digestResult.data
        );

        setPrivateJsonHeaders(res);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },

    async exportAccountMemories(
      req: Request,
      res: Response,
      next: NextFunction
    ) {
      try {
        const result = await service.exportAccountMemories(req.authUser!.id);

        res.set({
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${result.downloadFilename}"`,
          "Content-Length": String(result.payload.byteLength),
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        res.status(200).send(result.payload);
      } catch (error) {
        next(error);
      }
    },

    async previewAccountMemoryImport(
      req: Request,
      res: Response,
      next: NextFunction
    ) {
      try {
        assertJsonPayload(req);
        const preview = await service.previewAccountMemoryImport(
          req.authUser!.id,
          req.body
        );

        setPrivateJsonHeaders(res);
        res.status(200).json(preview);
      } catch (error) {
        next(error);
      }
    },
  };
}

function assertJsonPayload(req: Request) {
  if (!req.is("application/json")) {
    throw new AppError(
      "Account Memory import requires a JSON payload.",
      415,
      "ACCOUNT_MEMORY_IMPORT_CONTENT_TYPE_UNSUPPORTED"
    );
  }

  if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
    throw new AppError(
      "Account Memory import package is invalid or unsupported.",
      400,
      "ACCOUNT_MEMORY_IMPORT_PACKAGE_INVALID"
    );
  }
}

function setPrivateJsonHeaders(res: Response) {
  res.set({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

export const {
  commitAccountMemoryImport,
  exportAccountMemories,
  previewAccountMemoryImport,
} = createAccountMemoryPortabilityController(
  accountMemoryPortabilityService
);
