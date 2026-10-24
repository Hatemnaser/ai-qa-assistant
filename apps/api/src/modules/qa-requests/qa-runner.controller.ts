import { runnerRegistrationSchema } from "@oddpath/qa-execution-contract";
import { AppError } from "../../lib/errors.js";
import type { NextFunction, Request, Response } from "express";

import { qaProjectParamsSchema } from "./qa-requests.schema.js";
import { qaRunnerService } from "./qa-runner.service.js";

export async function registerQaRunner(req: Request, res: Response, next: NextFunction) {
  try {
    const registration = runnerRegistrationSchema.parse(req.body);
    if (registration.schemaVersion !== (req.path.includes("/runner/v2/") ? 2 : 1)) throw new AppError("Runner protocol does not match this endpoint.", 409, "QA_RUNNER_PROTOCOL_MISMATCH");
    res.json(await qaRunnerService.register(
      req.qaIntegration!,
      registration
    ));
  } catch (error) { next(error); }
}

export async function listQaRunnerProfiles(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    res.json({ profiles: await qaRunnerService.listProfiles(req.authUser!.id, projectId) });
  } catch (error) { next(error); }
}
