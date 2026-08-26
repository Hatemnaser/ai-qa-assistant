import type { NextFunction, Request, Response } from "express";

import { clearAuthCookie } from "../auth/auth.cookies.js";
import { deleteAccountRequestSchema } from "./account.schema.js";
import { accountService } from "./account.service.js";

export type AccountService = Pick<typeof accountService, "deleteAccount">;

export function createDeleteAccountController(service: AccountService = accountService) {
  return async function deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const input = deleteAccountRequestSchema.parse(req.body);
      const response = await service.deleteAccount(req.authUser!.id, input);

      clearAuthCookie(res);
      res.json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const deleteAccount = createDeleteAccountController();
