import { runnerRegistrationV1Schema } from "@oddpath/qa-execution-contract";
import type { NextFunction, Request, Response } from "express";

import { qaProjectParamsSchema } from "./qa-requests.schema.js";
import { qaRunnerService } from "./qa-runner.service.js";

export async function registerQaRunner(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await qaRunnerService.register(
      req.qaIntegration!,
      runnerRegistrationV1Schema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function listQaRunnerProfiles(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = qaProjectParamsSchema.parse(req.params);
    res.json({ profiles: await qaRunnerService.listProfiles(req.authUser!.id, projectId) });
  } catch (error) { next(error); }
}
