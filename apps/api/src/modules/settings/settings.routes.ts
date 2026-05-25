import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { getSettings, updateSettings } from "./settings.controller.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);
settingsRouter.get("/", getSettings);
settingsRouter.put("/", updateSettings);
