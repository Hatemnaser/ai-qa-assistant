import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { exportProject } from "./data-portability.controller.js";

export const dataPortabilityRouter = Router();

dataPortabilityRouter.use(requireAuth);
dataPortabilityRouter.get("/projects/:projectId/export", exportProject);
