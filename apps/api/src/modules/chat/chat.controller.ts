import type { NextFunction, Request, Response } from "express";

import { clearAuthCookie, getAuthCookie } from "../auth/auth.cookies.js";
import { authService } from "../auth/auth.service.js";
import { getOrCreateGuestId } from "../usage/usage.cookies.js";
import { createChatReply } from "./chat.service.js";
import { chatRequestSchema } from "./chat.schema.js";

export async function sendChatMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const input = chatRequestSchema.parse(req.body);
    const sessionToken = getAuthCookie(req);
    const currentUser = await authService.getOptionalCurrentUser(sessionToken);
    const guestId = currentUser ? undefined : getOrCreateGuestId(req, res);

    if (sessionToken && !currentUser) {
      clearAuthCookie(res);
    }

    const response = await createChatReply(input, {
      guestId,
      ipAddress: req.ip,
      userId: currentUser?.id,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
}
