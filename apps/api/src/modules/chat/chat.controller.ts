import type { NextFunction, Request, Response } from "express";

import { logChatRateLimited } from "../../lib/security-events.js";
import { clearAuthCookie, getAuthCookie } from "../auth/auth.cookies.js";
import { authService } from "../auth/auth.service.js";
import { getOrCreateGuestId } from "../usage/usage.cookies.js";
import {
  CHAT_RATE_LIMITED_MESSAGE,
  isChatIdentityRateLimited,
  isChatIpRateLimited,
} from "./chat.rateLimit.js";
import { createChatReply } from "./chat.service.js";
import { chatRequestSchema } from "./chat.schema.js";

export async function sendChatMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;

    if (isChatIpRateLimited({ ipAddress })) {
      logChatRateLimited({
        identityType: "anonymous",
        ipAddress,
      });
      sendRateLimitedResponse(res);
      return;
    }

    const input = chatRequestSchema.parse(req.body);
    const sessionToken = getAuthCookie(req);
    const currentUser = await authService.getOptionalCurrentUser(sessionToken);
    const guestId = currentUser ? undefined : getOrCreateGuestId(req, res);

    if (sessionToken && !currentUser) {
      clearAuthCookie(res);
    }

    if (
      isChatIdentityRateLimited({
        guestId,
        userId: currentUser?.id,
      })
    ) {
      logChatRateLimited({
        guestId,
        identityType: currentUser ? "user" : guestId ? "guest" : "anonymous",
        ipAddress,
        userId: currentUser?.id,
      });
      sendRateLimitedResponse(res);
      return;
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

function sendRateLimitedResponse(res: Response) {
  res.status(429).json({
    code: "RATE_LIMITED",
    error: CHAT_RATE_LIMITED_MESSAGE,
    message: CHAT_RATE_LIMITED_MESSAGE,
  });
}
