import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { getAuthCookie } from "./auth.cookies.js";
import { authService } from "./auth.service.js";
import type { PublicAuthUser } from "./auth.types.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: PublicAuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const sessionToken = getAuthCookie(req);

    if (!sessionToken) {
      throw new AppError("Authentication is required.", 401, "SESSION_REQUIRED");
    }

    req.authUser = await authService.getCurrentUser(sessionToken);
    next();
  } catch (error) {
    next(error);
  }
}
