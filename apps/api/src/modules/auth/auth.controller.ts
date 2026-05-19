import type { NextFunction, Request, Response } from "express";

import { clearAuthCookie, getAuthCookie, setAuthCookie } from "./auth.cookies.js";
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

    setAuthCookie(res, response.sessionToken, response.sessionExpiresAt);
    res.status(201).json(response.response);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const input = loginRequestSchema.parse(req.body);
    const response = await authService.login(input, getRequestContext(req));

    setAuthCookie(res, response.sessionToken, response.sessionExpiresAt);
    res.json(response.response);
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

export function getCurrentUser(req: Request, res: Response) {
  res.json({
    user: req.authUser,
  });
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logout(getAuthCookie(req));
    clearAuthCookie(res);

    res.json({
      ok: true,
    });
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
