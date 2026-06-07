import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { projectInstructionInputSchema } from "./project-instructions.schema.js";
import { projectInstructionsService } from "./project-instructions.service.js";

export async function getProjectInstruction(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      instruction: await projectInstructionsService.getProjectInstruction(
        req.authUser!.id,
        getProjectIdParam(req)
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function saveProjectInstruction(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      instruction: await projectInstructionsService.saveProjectInstruction(
        req.authUser!.id,
        getProjectIdParam(req),
        projectInstructionInputSchema.parse(req.body)
      ),
    });
  } catch (error) {
    next(error);
  }
}

function getProjectIdParam(req: Request) {
  const projectId = req.params.projectId;

  if (typeof projectId !== "string" || !projectId) {
    throw new AppError("Project id is required.", 400, "PROJECT_ID_REQUIRED");
  }

  return projectId;
}
