import type { NextFunction, Request, Response } from "express";

import {
  connectionParamsSchema,
  connectionProjectParamsSchema,
  createProjectConnectionSchema,
} from "./project-connections.schema.js";
import { projectConnectionsService } from "./project-connections.service.js";

export async function listProjectConnections(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = connectionProjectParamsSchema.parse(req.params);
    res.json({ connections: await projectConnectionsService.listConnections(req.authUser!.id, projectId) });
  } catch (error) { next(error); }
}

export async function createProjectConnection(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = connectionProjectParamsSchema.parse(req.params);
    res.status(201).json(await projectConnectionsService.createConnection(
      req.authUser!.id,
      projectId,
      createProjectConnectionSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function revokeProjectConnection(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, connectionId } = connectionParamsSchema.parse(req.params);
    res.json(await projectConnectionsService.revokeConnection(req.authUser!.id, projectId, connectionId));
  } catch (error) { next(error); }
}
