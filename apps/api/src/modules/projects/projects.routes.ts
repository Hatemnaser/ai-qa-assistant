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
import { qaRequestsRouter } from "../qa-requests/qa-requests.routes.js";
import { qaTargetsRouter } from "../qa-targets/qa-targets.routes.js";
import { readinessRouter } from '../readiness/readiness.routes.js';
import { browserRuntimeRouter } from "../browser-runtime/browser-runtime.routes.js";
import { browserAuthRouter } from "../browser-auth/browser-auth.routes.js";
import { testSessionsRouter } from "../test-sessions/test-sessions.routes.js";
import { projectConnectionsRouter } from "../project-connections/project-connections.routes.js";
import { createProject, deleteProject, listProjects, updateProject } from "./projects.controller.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);
projectsRouter.get("/", listProjects);
projectsRouter.post("/", createProject);
projectsRouter.use("/:projectId/qa", qaRequestsRouter);
projectsRouter.use('/:projectId/qa/requests/:requestId/readiness', readinessRouter);
projectsRouter.use("/:projectId/qa-targets", qaTargetsRouter);
projectsRouter.use("/:projectId/browser-runtimes", browserRuntimeRouter);
projectsRouter.use("/:projectId/saved-browser-logins", browserAuthRouter);
projectsRouter.use("/:projectId/test-sessions", testSessionsRouter);
projectsRouter.use("/:projectId/connections", projectConnectionsRouter);
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
