import type { NextFunction, Request, Response } from "express";

import { externalIdempotencyService } from "../project-connections/external-idempotency.service.js";
import {
  generateQaExecutionRecipeSchema,
  qaRecipeParamsSchema,
  retryQaExecutionRecipeReviewSchema,
  submitQaExecutionRecipeSchema,
} from "./qa-execution-recipes.schema.js";
import { qaExecutionRecipesService } from "./qa-execution-recipes.service.js";
import type { QaActor, QaTransport } from "./qa-requests.types.js";

export async function listQaExecutionRecipes(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.json({
      recipes: await qaExecutionRecipesService.listRecipes(
        req.authUser!.id,
        projectId,
        requestId
      ),
    });
  } catch (error) { next(error); }
}

export async function getQaExecutionRecipe(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, recipeId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.json({
      recipe: await qaExecutionRecipesService.getRecipe(
        req.authUser!.id,
        projectId,
        requestId,
        recipeId!
      ),
    });
  } catch (error) { next(error); }
}

export async function generateQaExecutionRecipe(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.status(202).json(await qaExecutionRecipesService.generateRecipe(
      req.authUser!.id,
      projectId,
      requestId,
      generateQaExecutionRecipeSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function retryQaExecutionRecipeReview(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, recipeId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.status(202).json(await qaExecutionRecipesService.retryRecipeReview(
      req.authUser!.id,
      projectId,
      requestId,
      recipeId!,
      retryQaExecutionRecipeReviewSchema.parse(req.body)
    ));
  } catch (error) { next(error); }
}

export async function agentListQaExecutionRecipes(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.json({ recipes: await qaExecutionRecipesService.agentListRecipes(projectId, requestId) });
  } catch (error) { next(error); }
}

export async function agentGetQaExecutionRecipe(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, recipeId, requestId } = qaRecipeParamsSchema.parse(req.params);
    res.json({
      recipe: await qaExecutionRecipesService.agentGetRecipe(projectId, requestId, recipeId!),
    });
  } catch (error) { next(error); }
}

export async function agentSubmitQaExecutionRecipe(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, requestId } = qaRecipeParamsSchema.parse(req.params);
    const input = submitQaExecutionRecipeSchema.parse(req.body);
    const result = await externalIdempotencyService.execute(
      {
        credentialId: req.qaIntegration!.connectionId,
        key: req.get("idempotency-key") || undefined,
        operation: "qa.execution-recipe.submit",
        request: { input, projectId, requestId },
      },
      async () => ({
        body: await qaExecutionRecipesService.agentSubmitRecipe(
          integrationActor(req),
          projectId,
          requestId,
          input
        ),
        status: 202,
      })
    );
    if (result.replayed) res.setHeader("Idempotent-Replayed", "true");
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
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
