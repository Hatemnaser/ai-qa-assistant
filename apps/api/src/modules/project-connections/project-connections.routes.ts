import { Router } from "express";

import {
  createProjectConnection,
  listProjectConnections,
  revokeProjectConnection,
} from "./project-connections.controller.js";

export const projectConnectionsRouter = Router({ mergeParams: true });

projectConnectionsRouter.get("/", listProjectConnections);
projectConnectionsRouter.post("/", createProjectConnection);
projectConnectionsRouter.delete("/:connectionId", revokeProjectConnection);
