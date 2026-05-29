import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { createProject, deleteProject, listProjects, updateProject } from "./projects.controller.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);
projectsRouter.get("/", listProjects);
projectsRouter.post("/", createProject);
projectsRouter.put("/:projectId", updateProject);
projectsRouter.delete("/:projectId", deleteProject);
