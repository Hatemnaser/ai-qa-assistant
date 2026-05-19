import type { NextFunction, Request, Response } from "express";

import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
} from "./auth.schema.js";
import { authService } from "./auth.service.js";
import type { AuthRequestContext } from "./auth.types.js";

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const input = registerRequestSchema.parse(req.body);
    const response = await authService.register(input, getRequestContext(req));

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = loginRequestSchema.parse(req.body);
    const response = await authService.login(input, getRequestContext(req));

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const input = forgotPasswordRequestSchema.parse(req.body);
    const response = await authService.requestPasswordReset(input);

    res.json(response);
  } catch (error) {
    next(error);
  }
}

function getRequestContext(req: Request): AuthRequestContext {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || undefined,
  };
}
