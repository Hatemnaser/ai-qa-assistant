import { Router } from "express";

import {
  addQaEvidence,
  cancelQaExecution,
  createQaRequest,
  finishQaRun,
  getQaOperation,
  getQaRequest,
  getQaSample,
  listQaRequests,
  recordQaCheckResult,
  reviewQaRun,
  selectQaArtifact,
  startQaRun,
  submitQaChecklist,
} from "./qa-requests.controller.js";
import {
  generateQaExecutionRecipe,
  getQaExecutionRecipe,
  listQaExecutionRecipes,
  retryQaExecutionRecipeReview,
} from "./qa-execution-recipes.controller.js";
import { listQaRunnerProfiles } from "./qa-runner.controller.js";

export const qaRequestsRouter = Router({ mergeParams: true });

qaRequestsRouter.get("/sample", getQaSample);
qaRequestsRouter.get("/runner-profiles", listQaRunnerProfiles);
qaRequestsRouter.get("/requests", listQaRequests);
qaRequestsRouter.post("/requests", createQaRequest);
qaRequestsRouter.get("/operations/:operationId", getQaOperation);
qaRequestsRouter.get("/requests/:requestId", getQaRequest);
qaRequestsRouter.get("/requests/:requestId/execution-recipes", listQaExecutionRecipes);
qaRequestsRouter.post(
  "/requests/:requestId/execution-recipes/generate",
  generateQaExecutionRecipe
);
qaRequestsRouter.get(
  "/requests/:requestId/execution-recipes/:recipeId",
  getQaExecutionRecipe
);
qaRequestsRouter.post(
  "/requests/:requestId/execution-recipes/:recipeId/review/retry",
  retryQaExecutionRecipeReview
);
qaRequestsRouter.post("/requests/:requestId/checklists", submitQaChecklist);
qaRequestsRouter.post("/requests/:requestId/artifacts/:artifactId/select", selectQaArtifact);
qaRequestsRouter.post("/requests/:requestId/runs", startQaRun);
qaRequestsRouter.post("/requests/:requestId/runs/:runId/cancel", cancelQaExecution);
qaRequestsRouter.put(
  "/requests/:requestId/runs/:runId/results/:checklistItemId",
  recordQaCheckResult
);
qaRequestsRouter.post("/requests/:requestId/runs/:runId/evidence", addQaEvidence);
qaRequestsRouter.post("/requests/:requestId/runs/:runId/finish", finishQaRun);
qaRequestsRouter.post("/requests/:requestId/runs/:runId/reviews", reviewQaRun);
