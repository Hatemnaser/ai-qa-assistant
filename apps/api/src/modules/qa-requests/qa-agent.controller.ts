import type { NextFunction, Request, Response } from "express";

import { externalIdempotencyService } from "../project-connections/external-idempotency.service.js";
import type { QaActor, QaTransport } from "./qa-requests.types.js";
import { qaAgentService } from "./qa-agent.service.js";
import {
  addQaEvidenceSchema,
  createAgentQaRequestSchema,
  finishQaRunSchema,
  listQaRequestsQuerySchema,
  qaCheckResultParamsSchema,
  qaOperationParamsSchema,
  qaProjectParamsSchema,
  qaRequestParamsSchema,
  qaRunParamsSchema,
  recordQaCheckResultSchema,
  startQaRunSchema,
  submitQaChecklistSchema,
} from "./qa-requests.schema.js";

export async function agentListQaRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    const input = listQaRequestsQuerySchema.parse(req.query);
    res.json(await qaAgentService.listRequests(projectId, input));
  } catch (error) { next(error); }
}

export async function agentGetQaRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    res.json({ request: await qaAgentService.getRequest(projectId, requestId) });
  } catch (error) { next(error); }
}

export async function agentGetQaOperation(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, operationId } = qaOperationParamsSchema.parse(req.params);
    res.json({ operation: await qaAgentService.getOperation(projectId, operationId) });
  } catch (error) { next(error); }
}

export async function agentCreateQaRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    const input = createAgentQaRequestSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.request.create",
      { input, projectId },
      201,
      () => qaAgentService.createRequest(integrationActor(req), projectId, input)
    );
  } catch (error) { next(error); }
}

export async function agentSubmitQaChecklist(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    const input = submitQaChecklistSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.checklist.submit",
      { input, projectId, requestId },
      202,
      () => qaAgentService.submitChecklist(
        integrationActor(req),
        projectId,
        requestId,
        input
      )
    );
  } catch (error) { next(error); }
}

export async function agentStartQaRun(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    const input = startQaRunSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.run.start",
      { input, projectId, requestId },
      201,
      () => qaAgentService.startRun(integrationActor(req), projectId, requestId, input)
    );
  } catch (error) { next(error); }
}

export async function agentRecordQaCheckResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId, checklistItemId } = qaCheckResultParamsSchema.parse(req.params);
    const input = recordQaCheckResultSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.result.record",
      { checklistItemId, input, projectId, requestId, runId },
      200,
      async () => ({
      request: await qaAgentService.recordCheckResult(
        integrationActor(req),
        projectId,
        requestId,
        runId,
        checklistItemId,
        input
      ),
      })
    );
  } catch (error) { next(error); }
}

export async function agentAddQaEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    const input = addQaEvidenceSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.evidence.add",
      { input, projectId, requestId, runId },
      201,
      () => qaAgentService.addEvidence(integrationActor(req), projectId, requestId, runId, input)
    );
  } catch (error) { next(error); }
}

export async function agentFinishQaRun(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    const input = finishQaRunSchema.parse(req.body);
    await respondToAgentMutation(
      req,
      res,
      "qa.run.finish",
      { input, projectId, requestId, runId },
      200,
      async () => ({
      request: await qaAgentService.finishRun(
        integrationActor(req),
        projectId,
        requestId,
        runId,
        input
      ),
      })
    );
  } catch (error) { next(error); }
}

async function respondToAgentMutation<T>(
  req: Request,
  res: Response,
  operation: string,
  request: unknown,
  status: number,
  action: () => Promise<T>
) {
  const result = await externalIdempotencyService.execute(
    {
      credentialId: req.qaIntegration!.connectionId,
      key: req.get("idempotency-key") || undefined,
      operation,
      request,
    },
    async () => ({ body: await action(), status })
  );
  if (result.replayed) res.setHeader("Idempotent-Replayed", "true");
  res.status(result.status).json(result.body);
}

function integrationActor(req: Request): QaActor {
  const auth = req.qaIntegration!;
  return {
    connectionTokenId: auth.connectionId,
    kind: "INTEGRATION",
    transport: readTransport(req),
    userId: auth.ownerId,
  };
}

function readTransport(req: Request): QaTransport {
  return req.get("x-oddpath-transport")?.toUpperCase() === "MCP" ? "MCP" : "REST";
}
