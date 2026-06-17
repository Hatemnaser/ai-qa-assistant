import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { projectMemoryInputSchema } from "./project-memory.schema.js";
import { projectMemoryService } from "./project-memory.service.js";

export async function getProjectMemory(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json({
      memory: await projectMemoryService.getProjectMemory(
        req.authUser!.id,
        getProjectIdParam(req)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function saveProjectMemory(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    res.json({
      memory: await projectMemoryService.saveProjectMemory(
        req.authUser!.id,
        getProjectIdParam(req),
        projectMemoryInputSchema.parse(req.body)
      ),
    });
  } catch (error) {
    next(error);
  }
}

function getProjectIdParam(req: Request) {
  const projectId = req.params.projectId;

  if (typeof projectId !== "string" || !projectId) {
    throw new AppError(
      "Project id is required.",
      400,
      "PROJECT_ID_REQUIRED"
    );
  }

  return projectId;
}
