import express, { Router } from "express";

import { requireAuth } from "../auth/auth.middleware.js";
import { accountExportRateLimit } from "./account-export.rateLimit.js";
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
import {
  portabilityConcurrencyLimit,
  portabilityImportCommitRateLimit,
  portabilityImportPreviewRateLimit,
  projectExportRateLimit,
  requirePortabilityImportsEnabled,
} from "./portability.guard.js";

export const dataPortabilityRouter = Router();

dataPortabilityRouter.use(requireAuth);
dataPortabilityRouter.post(
  "/account/export",
  accountExportRateLimit,
  portabilityConcurrencyLimit,
  exportAccountData
);
dataPortabilityRouter.post(
  "/account/import/commit",
  requirePortabilityImportsEnabled,
  portabilityImportCommitRateLimit,
  portabilityConcurrencyLimit,
  express.raw({
    limit: ACCOUNT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  commitAccountImport
);
dataPortabilityRouter.post(
  "/account/import/preview",
  requirePortabilityImportsEnabled,
  portabilityImportPreviewRateLimit,
  portabilityConcurrencyLimit,
  express.raw({
    limit: ACCOUNT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  previewAccountImport
);
dataPortabilityRouter.post(
  "/projects/:projectId/export",
  projectExportRateLimit,
  portabilityConcurrencyLimit,
  exportProject
);
dataPortabilityRouter.post(
  "/projects/import/commit",
  requirePortabilityImportsEnabled,
  portabilityImportCommitRateLimit,
  portabilityConcurrencyLimit,
  express.raw({
    limit: PROJECT_IMPORT_LIMITS.maxCompressedBytes,
    type: "application/zip",
  }),
  commitProjectImport
);
dataPortabilityRouter.post(
  "/projects/import/preview",
  requirePortabilityImportsEnabled,
  portabilityImportPreviewRateLimit,
  portabilityConcurrencyLimit,
  express.raw({
    limit: PROJECT_IMPORT_LIMITS.maxCompressedBytes,
    type: ["application/zip", "application/octet-stream"],
  }),
  previewProjectImport
);
