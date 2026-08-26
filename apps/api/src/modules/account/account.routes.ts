import { Router, type RequestHandler } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { createDeleteAccountController, type AccountService } from "./account.controller.js";
import { accountDeletionRateLimit } from "./account.rateLimit.js";
import { accountService } from "./account.service.js";

export interface AccountRouterOptions {
  accountDeletionRateLimitMiddleware?: RequestHandler;
  requireAuthMiddleware?: RequestHandler;
  service?: AccountService;
}

export function createAccountRouter({
  accountDeletionRateLimitMiddleware = accountDeletionRateLimit,
  requireAuthMiddleware = requireAuth,
  service = accountService,
}: AccountRouterOptions = {}) {
  const router = Router();

  router.delete(
    "/",
    requireAuthMiddleware,
    accountDeletionRateLimitMiddleware,
    createDeleteAccountController(service)
  );

  return router;
}

export const accountRouter = createAccountRouter();
