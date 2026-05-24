import { Router } from "express";

import { listAiModels } from "./ai.controller.js";

export const aiRouter = Router();

aiRouter.get("/models", listAiModels);
