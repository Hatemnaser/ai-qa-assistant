import type { NextFunction, Request, Response } from "express";

import { AppError } from "../../lib/errors.js";
import { memoryInputSchema } from "./memory.schema.js";
import { memoryService } from "./memory.service.js";

export async function listAccountMemories(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({
      memories: await memoryService.listAccountMemories(req.authUser!.id),
    });
  } catch (error) {
    next(error);
  }
}

export async function createAccountMemory(req: Request, res: Response, next: NextFunction) {
  try {
    const memory = await memoryService.createAccountMemory(req.authUser!.id, memoryInputSchema.parse(req.body));

    res.status(201).json({
      memory,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateAccountMemory(req: Request, res: Response, next: NextFunction) {
  try {
    const memory = await memoryService.updateAccountMemory(
      req.authUser!.id,
      getMemoryIdParam(req),
      memoryInputSchema.parse(req.body)
    );

    res.json({
      memory,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAccountMemory(req: Request, res: Response, next: NextFunction) {
  try {
    await memoryService.deleteAccountMemory(req.authUser!.id, getMemoryIdParam(req));

    res.json({
      ok: true,
    });
  } catch (error) {
    next(error);
  }
}

function getMemoryIdParam(req: Request) {
  const memoryId = req.params.memoryId;

  if (typeof memoryId !== "string" || !memoryId) {
    throw new AppError("Memory id is required.", 400, "MEMORY_ID_REQUIRED");
  }

  return memoryId;
}
