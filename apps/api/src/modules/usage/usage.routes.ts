import { Router } from "express";

import { getUsageSummary } from "./usage.controller.js";

export const usageRouter = Router();

usageRouter.get("/summary", getUsageSummary);
