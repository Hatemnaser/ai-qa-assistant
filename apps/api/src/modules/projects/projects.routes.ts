import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectMemory,
  deleteProjectMemory,
  listProjectMemories,
  updateProjectMemory,
} from "../memory/memory.controller.js";
import { createProject, deleteProject, listProjects, updateProject } from "./projects.controller.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);
projectsRouter.get("/", listProjects);
projectsRouter.post("/", createProject);
projectsRouter.get("/:projectId/memories", listProjectMemories);
projectsRouter.post("/:projectId/memories", createProjectMemory);
projectsRouter.put("/:projectId/memories/:memoryId", updateProjectMemory);
projectsRouter.delete("/:projectId/memories/:memoryId", deleteProjectMemory);
projectsRouter.put("/:projectId", updateProject);
projectsRouter.delete("/:projectId", deleteProject);
