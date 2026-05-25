import type { NextFunction, Request, Response } from "express";

import { clearAuthCookie, getAuthCookie } from "../auth/auth.cookies.js";
import { authService } from "../auth/auth.service.js";
import { getOrCreateGuestId } from "./usage.cookies.js";
import { usageService } from "./usage.service.js";

export async function getUsageSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionToken = getAuthCookie(req);
    const currentUser = await authService.getOptionalCurrentUser(sessionToken);
    const guestId = currentUser ? undefined : getOrCreateGuestId(req, res);

    if (sessionToken && !currentUser) {
      clearAuthCookie(res);
    }

    const summary = await usageService.getChatCreditInsights({
      guestId,
      ipAddress: req.ip,
      userId: currentUser?.id,
    });

    res.json(summary);
  } catch (error) {
    next(error);
  }
}
