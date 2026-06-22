import type { NextFunction, Request, Response } from "express";

import { issueCsrfToken } from "../../middleware/csrf.middleware.js";
import { clearAuthCookie, getAuthCookie, setAuthCookie } from "./auth.cookies.js";
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
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

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const input = resetPasswordRequestSchema.parse(req.body);
    const response = await authService.resetPassword(input);

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const input = verifyEmailRequestSchema.parse(req.body);
    const response = await authService.verifyEmail(input);

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const input = resendVerificationRequestSchema.parse(req.body);
    const response = await authService.resendVerification(input);

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export function getCsrfToken(_req: Request, res: Response) {
  const csrfToken = issueCsrfToken(res);

  res.json({
    csrfToken,
  });
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
