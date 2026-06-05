import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import {
  createAccountMemory,
  deleteAccountMemory,
  listAccountMemories,
  updateAccountMemory,
} from "./memory.controller.js";

export const memoryRouter = Router();

memoryRouter.use(requireAuth);
memoryRouter.get("/", listAccountMemories);
memoryRouter.post("/", createAccountMemory);
memoryRouter.put("/:memoryId", updateAccountMemory);
memoryRouter.delete("/:memoryId", deleteAccountMemory);
