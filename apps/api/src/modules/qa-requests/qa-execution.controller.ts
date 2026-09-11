import {
  executionClaimRequestV1Schema,
  executionClaimResponseV1Schema,
  executionFailureV1Schema,
  executionFinishV1Schema,
  executionItemSubmissionV1Schema,
} from "@oddpath/qa-execution-contract";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { externalIdempotencyService } from "../project-connections/external-idempotency.service.js";
import { qaExecutionService } from "./qa-execution.service.js";
import {
  completeQaExecutionUploadSchema,
  initiateQaExecutionUploadSchema,
  qaExecutionUploadParamsSchema,
} from "./qa-execution-upload.schema.js";
import { qaExecutionUploadService } from "./qa-execution-upload.service.js";

const executionParamsSchema = z.object({
  checklistItemId: z.string().trim().min(1).max(120).optional(),
  executionId: z.string().trim().min(1).max(120),
}).strict();
const leaseSchema = z.object({
  claimId: z.string().uuid(),
  leaseToken: z.string().min(32).max(240),
}).strict();

export async function claimQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const claim = await qaExecutionService.claim(
      req.qaIntegration!,
      executionClaimRequestV1Schema.parse(req.body)
    );
    res.json(executionClaimResponseV1Schema.parse(claim === null ? { claim: null } : claim));
  } catch (error) { next(error); }
}

export async function acceptQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const { executionId } = executionParamsSchema.parse(req.params);
    res.json({ receipt: await qaExecutionService.accept(req.qaIntegration!, executionId, readLease(req)) });
  } catch (error) { next(error); }
}

export async function heartbeatQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const { executionId } = executionParamsSchema.parse(req.params);
    res.json({ receipt: await qaExecutionService.heartbeat(req.qaIntegration!, executionId, readLease(req)) });
  } catch (error) { next(error); }
}

export async function recordQaExecutionItem(req: Request, res: Response, next: NextFunction) {
  try {
    const { checklistItemId, executionId } = executionParamsSchema.parse(req.params);
    const lease = readLease(req);
    const submission = executionItemSubmissionV1Schema.parse(req.body);
    await respondToRunnerMutation(
      req,
      res,
      `qa.execution.item.${checklistItemId}`,
      { checklistItemId, claimId: lease.claimId, executionId, submission },
      async () => ({
        receipt: await qaExecutionService.recordItem(
          req.qaIntegration!,
          executionId,
          checklistItemId!,
          lease,
          submission
        ),
      })
    );
  } catch (error) { next(error); }
}

export async function finishQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const { executionId } = executionParamsSchema.parse(req.params);
    const lease = readLease(req);
    const finish = executionFinishV1Schema.parse(req.body);
    await respondToRunnerMutation(
      req,
      res,
      "qa.execution.finish",
      { claimId: lease.claimId, executionId, finish },
      async () => ({
        receipt: await qaExecutionService.finish(
          req.qaIntegration!,
          executionId,
          lease,
          finish
        ),
      })
    );
  } catch (error) { next(error); }
}

export async function failQaExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const { executionId } = executionParamsSchema.parse(req.params);
    const lease = readLease(req);
    const failure = executionFailureV1Schema.parse(req.body);
    await respondToRunnerMutation(
      req,
      res,
      "qa.execution.fail",
      { claimId: lease.claimId, executionId, failure },
      async () => ({
        receipt: await qaExecutionService.fail(
          req.qaIntegration!,
          executionId,
          lease,
          failure
        ),
      })
    );
  } catch (error) { next(error); }
}

export async function initiateQaExecutionUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const { executionId } = qaExecutionUploadParamsSchema.parse(req.params);
    const lease = readLease(req);
    const input = initiateQaExecutionUploadSchema.parse(req.body);
    await respondToRunnerMutation(
      req,
      res,
      "qa.execution.upload.initiate",
      { claimId: lease.claimId, executionId, input },
      () => qaExecutionUploadService.initiate(req.qaIntegration!, executionId, lease, input),
      201
    );
  } catch (error) { next(error); }
}

export async function completeQaExecutionUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const { assetId, executionId } = qaExecutionUploadParamsSchema.parse(req.params);
    const lease = readLease(req);
    const input = completeQaExecutionUploadSchema.parse(req.body);
    await respondToRunnerMutation(
      req,
      res,
      "qa.execution.upload.complete",
      { assetId, claimId: lease.claimId, executionId, input },
      async () => ({
        asset: await qaExecutionUploadService.complete(
          req.qaIntegration!,
          executionId,
          assetId!,
          lease,
          input
        ),
      })
    );
  } catch (error) { next(error); }
}

function readLease(req: Request) {
  return leaseSchema.parse({
    claimId: req.get("x-oddpath-claim-id"),
    leaseToken: req.get("x-oddpath-execution-lease"),
  });
}

async function respondToRunnerMutation<T>(
  req: Request,
  res: Response,
  operation: string,
  request: unknown,
  action: () => Promise<T>,
  status = 200
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
