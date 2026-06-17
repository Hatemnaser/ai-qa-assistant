import { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectDocument,
  deleteProjectDocument,
  importProjectDocuments,
  listProjectDocuments,
  updateProjectDocument,
} from "../project-documents/project-documents.controller.js";
import {
  getProjectInstruction,
  saveProjectInstruction,
} from "../project-instructions/project-instructions.controller.js";
import {
  getProjectMemory,
  saveProjectMemory,
} from "../project-memory/project-memory.controller.js";
import { createProject, deleteProject, listProjects, updateProject } from "./projects.controller.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);
projectsRouter.get("/", listProjects);
projectsRouter.post("/", createProject);
projectsRouter.get("/:projectId/instructions", getProjectInstruction);
projectsRouter.put("/:projectId/instructions", saveProjectInstruction);
projectsRouter.get("/:projectId/memory", getProjectMemory);
projectsRouter.put("/:projectId/memory", saveProjectMemory);
projectsRouter.get("/:projectId/documents", listProjectDocuments);
projectsRouter.post("/:projectId/documents", createProjectDocument);
projectsRouter.post("/:projectId/documents/import", importProjectDocuments);
projectsRouter.put("/:projectId/documents/:documentId", updateProjectDocument);
projectsRouter.delete("/:projectId/documents/:documentId", deleteProjectDocument);
projectsRouter.put("/:projectId", updateProject);
projectsRouter.delete("/:projectId", deleteProject);
