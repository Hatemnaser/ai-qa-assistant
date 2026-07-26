import express, { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { exportAccountData } from "./account-data-portability.controller.js";
import {
  commitAccountImport,
  previewAccountImport,
} from "./account-import.controller.js";
import { ACCOUNT_IMPORT_LIMITS } from "./account-import.types.js";
import {
  commitProjectImport,
  exportProject,
  previewProjectImport,
} from "./data-portability.controller.js";
import { PROJECT_IMPORT_LIMITS } from "./data-portability.types.js";

export const dataPortabilityRouter = Router();

dataPortabilityRouter.use(requireAuth);
dataPortabilityRouter.get("/account/export", exportAccountData);
dataPortabilityRouter.post(
  "/account/import/commit",
  express.raw({
    limit: ACCOUNT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  commitAccountImport
);
dataPortabilityRouter.post(
  "/account/import/preview",
  express.raw({
    limit: ACCOUNT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  previewAccountImport
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
