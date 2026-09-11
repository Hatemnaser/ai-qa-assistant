import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { projectConnectionsService } from "./project-connections.service.js";
import type { QaConnectionScope } from "./project-connections.schema.js";

export interface QaIntegrationAuth {
  connectionId: string;
  ownerId: string;
  projectId: string;
  scopes: QaConnectionScope[];
}

declare global {
  namespace Express {
    interface Request {
      qaIntegration?: QaIntegrationAuth;
    }
  }
}

export async function requireProjectConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.qaIntegration) {
      next();
      return;
    }
    const authorization = req.get("authorization") || "";
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
    if (!match?.[1]) {
      throw new AppError("A project connection token is required.", 401, "CONNECTION_TOKEN_REQUIRED");
    }
    req.qaIntegration = await projectConnectionsService.authenticate(match[1]);
    next();
  } catch (error) {
    // This guard runs before the JSON parser. Do not drain or reuse an
    // unauthenticated caller's potentially large request body.
    req.pause();
    res.shouldKeepAlive = false;
    res.setHeader("Connection", "close");
    next(error);
  }
}

export function requireConnectionScope(scope: QaConnectionScope) {
  return function connectionScopeMiddleware(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.qaIntegration?.scopes.includes(scope)) {
        throw new AppError("Connection scope is insufficient.", 403, "CONNECTION_SCOPE_REQUIRED");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireConnectedProject(req: Request, _res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    if (typeof projectId !== "string" || projectId !== req.qaIntegration?.projectId) {
      throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
    }
    next();
  } catch (error) {
    next(error);
  }
}
