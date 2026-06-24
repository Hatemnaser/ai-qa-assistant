import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { projectExportQuerySchema } from "./data-portability.schema.js";
import {
  dataPortabilityService,
  type DataPortabilityService,
} from "./data-portability.service.js";

export function createDataPortabilityController(service: DataPortabilityService) {
  return {
    async exportProject(req: Request, res: Response, next: NextFunction) {
      try {
        const projectId = getProjectIdParam(req);
        const { includeChats } = projectExportQuerySchema.parse(req.query);
        const result = await service.exportOwnedProject(req.authUser!.id, projectId, {
          includeChats,
        });

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

    async previewProjectImport(req: Request, res: Response, next: NextFunction) {
      try {
        if (!req.is(["application/zip", "application/octet-stream"])) {
          throw new AppError(
            "Project import preview requires a ZIP payload.",
            415,
            "PROJECT_IMPORT_CONTENT_TYPE_UNSUPPORTED"
          );
        }

        if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
          throw new AppError(
            "Project import package is invalid or unsupported.",
            400,
            "PROJECT_IMPORT_PACKAGE_INVALID"
          );
        }

        const preview = await service.previewProjectImport(req.body);

        res.status(200).json(preview);
      } catch (error) {
        next(error);
      }
    },
  };
}

function getProjectIdParam(req: Request) {
  const projectId = req.params.projectId;

  if (typeof projectId !== "string" || !projectId) {
    throw new AppError("Project id is required.", 400, "PROJECT_ID_REQUIRED");
  }

  return projectId;
}

export const { exportProject, previewProjectImport } =
  createDataPortabilityController(dataPortabilityService);
