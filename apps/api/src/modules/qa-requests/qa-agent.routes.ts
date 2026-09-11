import { Router } from "express";

import {
  requireConnectedProject,
  requireConnectionScope,
  requireProjectConnection,
} from "../project-connections/project-connections.middleware.js";
import {
  agentAddQaEvidence,
  agentCreateQaRequest,
  agentFinishQaRun,
  agentGetQaOperation,
  agentGetQaRequest,
  agentListQaRequests,
  agentRecordQaCheckResult,
  agentStartQaRun,
  agentSubmitQaChecklist,
} from "./qa-agent.controller.js";
import {
  agentGetQaExecutionRecipe,
  agentListQaExecutionRecipes,
  agentSubmitQaExecutionRecipe,
} from "./qa-execution-recipes.controller.js";
import { registerQaRunner } from "./qa-runner.controller.js";
import {
  acceptQaExecution,
  claimQaExecution,
  failQaExecution,
  finishQaExecution,
  heartbeatQaExecution,
  initiateQaExecutionUpload,
  completeQaExecutionUpload,
  recordQaExecutionItem,
} from "./qa-execution.controller.js";

export const qaAgentRouter = Router();

qaAgentRouter.use(requireProjectConnection);
qaAgentRouter.put(
  "/runner/v1/registration",
  requireConnectionScope("execution:claim"),
  registerQaRunner
);
qaAgentRouter.post(
  "/runner/v1/executions/claim",
  requireConnectionScope("execution:claim"),
  claimQaExecution
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/accept",
  requireConnectionScope("execution:write"),
  acceptQaExecution
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/heartbeat",
  requireConnectionScope("execution:write"),
  heartbeatQaExecution
);
qaAgentRouter.put(
  "/runner/v1/executions/:executionId/items/:checklistItemId",
  requireConnectionScope("execution:write"),
  recordQaExecutionItem
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/finish",
  requireConnectionScope("execution:write"),
  finishQaExecution
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/fail",
  requireConnectionScope("execution:write"),
  failQaExecution
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/evidence/uploads",
  requireConnectionScope("execution:write"),
  requireConnectionScope("evidence:write"),
  initiateQaExecutionUpload
);
qaAgentRouter.post(
  "/runner/v1/executions/:executionId/evidence/uploads/:assetId/complete",
  requireConnectionScope("execution:write"),
  requireConnectionScope("evidence:write"),
  completeQaExecutionUpload
);
qaAgentRouter.use("/projects/:projectId", requireConnectedProject);
qaAgentRouter.get(
  "/projects/:projectId/qa/requests",
  requireConnectionScope("qa:read"),
  agentListQaRequests
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentCreateQaRequest
);
qaAgentRouter.get(
  "/projects/:projectId/qa/operations/:operationId",
  requireConnectionScope("qa:read"),
  agentGetQaOperation
);
qaAgentRouter.get(
  "/projects/:projectId/qa/requests/:requestId",
  requireConnectionScope("qa:read"),
  agentGetQaRequest
);
qaAgentRouter.get(
  "/projects/:projectId/qa/requests/:requestId/execution-recipes",
  requireConnectionScope("qa:read"),
  agentListQaExecutionRecipes
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests/:requestId/execution-recipes",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentSubmitQaExecutionRecipe
);
qaAgentRouter.get(
  "/projects/:projectId/qa/requests/:requestId/execution-recipes/:recipeId",
  requireConnectionScope("qa:read"),
  agentGetQaExecutionRecipe
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests/:requestId/checklists",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentSubmitQaChecklist
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests/:requestId/runs",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentStartQaRun
);
qaAgentRouter.put(
  "/projects/:projectId/qa/requests/:requestId/runs/:runId/results/:checklistItemId",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentRecordQaCheckResult
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests/:requestId/runs/:runId/evidence",
  requireConnectionScope("qa:read"),
  requireConnectionScope("evidence:write"),
  agentAddQaEvidence
);
qaAgentRouter.post(
  "/projects/:projectId/qa/requests/:requestId/runs/:runId/finish",
  requireConnectionScope("qa:read"),
  requireConnectionScope("qa:write"),
  agentFinishQaRun
);
