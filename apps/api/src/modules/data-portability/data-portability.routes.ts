import express, { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import {
  commitAccountMemoryImport,
  exportAccountMemories,
  previewAccountMemoryImport,
} from "./account-memory-portability.controller.js";
import { ACCOUNT_MEMORY_IMPORT_LIMITS } from "./account-memory-portability.types.js";
import {
  commitProjectImport,
  exportProject,
  previewProjectImport,
} from "./data-portability.controller.js";
import { PROJECT_IMPORT_LIMITS } from "./data-portability.types.js";

export const dataPortabilityRouter = Router();

dataPortabilityRouter.use(requireAuth);
dataPortabilityRouter.get(
  "/account/memories/export",
  exportAccountMemories
);
dataPortabilityRouter.post(
  "/account/memories/import/commit",
  express.raw({
    limit: ACCOUNT_MEMORY_IMPORT_LIMITS.maxPayloadBytes,
    type: "application/json",
  }),
  commitAccountMemoryImport
);
dataPortabilityRouter.post(
  "/account/memories/import/preview",
  express.raw({
    limit: ACCOUNT_MEMORY_IMPORT_LIMITS.maxPayloadBytes,
    type: "application/json",
  }),
  previewAccountMemoryImport
);
dataPortabilityRouter.get("/projects/:projectId/export", exportProject);
dataPortabilityRouter.post(
  "/projects/import/commit",
  express.raw({
    limit: PROJECT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  commitProjectImport
);
dataPortabilityRouter.post(
  "/projects/import/preview",
  express.raw({
    limit: PROJECT_IMPORT_LIMITS.maxCompressedBytes,
    type: ["application/zip", "application/octet-stream"],
  }),
  previewProjectImport
);
