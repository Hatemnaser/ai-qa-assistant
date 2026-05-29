import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { projectInputSchema } from "./projects.schema.js";
import { projectsService } from "./projects.service.js";

export async function listProjects(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      projects: await projectsService.listUserProjects(req.authUser!.id),
    });
  } catch (error) {
    next(error);
  }
}

export async function createProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectsService.createUserProject(
      req.authUser!.id,
      projectInputSchema.parse(req.body)
    );

    res.status(201).json({
      project,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProject(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectsService.updateUserProject(
      req.authUser!.id,
      getProjectIdParam(req),
      projectInputSchema.parse(req.body)
    );

    res.json({
      project,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProject(req: Request, res: Response, next: NextFunction) {
  try {
    await projectsService.deleteUserProject(req.authUser!.id, getProjectIdParam(req));

    res.json({
      ok: true,
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
