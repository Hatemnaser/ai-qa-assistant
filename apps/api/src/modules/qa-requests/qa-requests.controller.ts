import type { NextFunction, Request, Response } from "express";

import {
  addQaEvidenceSchema,
  createQaRequestSchema,
  finishQaRunSchema,
  listQaRequestsQuerySchema,
  qaArtifactParamsSchema,
  qaCheckResultParamsSchema,
  qaOperationParamsSchema,
  qaProjectParamsSchema,
  qaRequestParamsSchema,
  qaRunParamsSchema,
  recordQaCheckResultSchema,
  reviewQaRunSchema,
  selectQaArtifactSchema,
  startQaRunSchema,
  submitQaChecklistSchema,
} from "./qa-requests.schema.js";
import { qaRequestsService } from "./qa-requests.service.js";

export async function listQaRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    res.json(await qaRequestsService.listRequests(
      req.authUser!.id,
      projectId,
      listQaRequestsQuerySchema.parse(req.query)
    ));
  } catch (error) { next(error); }
}

export async function getQaRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    res.json({ request: await qaRequestsService.getRequest(req.authUser!.id, projectId, requestId) });
  } catch (error) { next(error); }
}

export async function getQaOperation(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, operationId } = qaOperationParamsSchema.parse(req.params);
    res.json({
      operation: await qaRequestsService.getOperation(req.authUser!.id, projectId, operationId),
    });
  } catch (error) { next(error); }
}

export async function getQaSample(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    res.json({ request: await qaRequestsService.getSample(req.authUser!.id, projectId) });
  } catch (error) { next(error); }
}

export async function createQaRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    const result = await qaRequestsService.createRequest(
      req.authUser!.id,
      projectId,
      createQaRequestSchema.parse(req.body)
    );
    res.status(result.operation ? 202 : 201).json(result);
  } catch (error) { next(error); }
}

export async function submitQaChecklist(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    res.status(202).json(await qaRequestsService.submitChecklist(
      req.authUser!.id,
      projectId,
      requestId,
      submitQaChecklistSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function selectQaArtifact(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, artifactId } = qaArtifactParamsSchema.parse(req.params);
    const { expectedRequestVersion } = selectQaArtifactSchema.parse(req.body);
    res.json({
      request: await qaRequestsService.selectArtifact(
        req.authUser!.id,
        projectId,
        requestId,
        artifactId,
        expectedRequestVersion
      ),
    });
  } catch (error) { next(error); }
}

export async function startQaRun(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRequestParamsSchema.parse(req.params);
    res.status(201).json(await qaRequestsService.startRun(
      req.authUser!.id,
      projectId,
      requestId,
      startQaRunSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function cancelQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    res.json({
      request: await qaRequestsService.cancelExecution(
        req.authUser!.id,
        projectId,
        requestId,
        runId
      ),
    });
  } catch (error) { next(error); }
}

export async function recordQaCheckResult(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId, checklistItemId } = qaCheckResultParamsSchema.parse(req.params);
    res.json({
      request: await qaRequestsService.recordCheckResult(
        req.authUser!.id,
        projectId,
        requestId,
        runId,
        checklistItemId,
        recordQaCheckResultSchema.parse(req.body)
      ),
    });
  } catch (error) { next(error); }
}

export async function addQaEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    res.status(201).json(await qaRequestsService.addEvidence(
      req.authUser!.id,
      projectId,
      requestId,
      runId,
      addQaEvidenceSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function finishQaRun(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    res.json({
      request: await qaRequestsService.finishRun(
        req.authUser!.id,
        projectId,
        requestId,
        runId,
        finishQaRunSchema.parse(req.body)
      ),
    });
  } catch (error) { next(error); }
}

export async function reviewQaRun(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId, runId } = qaRunParamsSchema.parse(req.params);
    res.json({
      request: await qaRequestsService.reviewRun(
        req.authUser!.id,
        projectId,
        requestId,
        runId,
        reviewQaRunSchema.parse(req.body)
      ),
    });
  } catch (error) { next(error); }
}
