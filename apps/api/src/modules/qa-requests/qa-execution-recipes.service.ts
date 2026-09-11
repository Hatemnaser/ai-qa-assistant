import { AppError } from "../../lib/errors.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import {
  qaExecutionRecipeRepository,
} from "./qa-execution-recipes.repository.js";
import type {
  GenerateQaExecutionRecipeInput,
  RetryQaExecutionRecipeReviewInput,
  SubmitQaExecutionRecipeInput,
} from "./qa-execution-recipes.schema.js";
import { qaProcessingRepository } from "./qa-processing.repository.js";
import type { QaProcessingRepository } from "./qa-processing.types.js";
import type { QaActor } from "./qa-requests.types.js";
import type { QaExecutionRecipeRepository } from "./qa-execution-recipes.types.js";

export interface QaExecutionRecipesServiceDependencies {
  processingRepository: Pick<QaProcessingRepository, "getOperation" | "getRequestOperation">;
  projectAccess: ProjectAccessService;
  repository: QaExecutionRecipeRepository;
}

export function createQaExecutionRecipesService({
  processingRepository,
  projectAccess,
  repository,
}: QaExecutionRecipesServiceDependencies) {
  async function listRecipes(userId: string, projectId: string, requestId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return repository.listRecipes(projectId, requestId);
  }

  async function getRecipe(userId: string, projectId: string, requestId: string, recipeId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return requireRecipe(await repository.getRecipe(projectId, requestId, recipeId));
  }

  async function generateRecipe(
    userId: string,
    projectId: string,
    requestId: string,
    input: GenerateQaExecutionRecipeInput
  ) {
    const actor: QaActor = { kind: "USER", transport: "WEB", userId };
    await projectAccess.assertProjectAccess(userId, projectId);
    const operationId = await repository.queueGeneration({
      actor,
      artifactId: input.artifactId,
      profileManifest: input.profileManifest,
      projectId,
      requestId,
    });
    return {
      operation: requireOperation(await processingRepository.getOperation(projectId, operationId)),
    };
  }

  async function retryRecipeReview(
    userId: string,
    projectId: string,
    requestId: string,
    recipeId: string,
    input: RetryQaExecutionRecipeReviewInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const operationId = await repository.queueReviewRetry({
      actor: { kind: "USER", transport: "WEB", userId },
      assessmentId: input.assessmentId,
      projectId,
      recipeId,
      requestId,
    });
    return {
      operation: requireOperation(await processingRepository.getOperation(projectId, operationId)),
    };
  }

  async function agentListRecipes(projectId: string, requestId: string) {
    return repository.listRecipes(projectId, requestId);
  }

  async function agentGetRecipe(projectId: string, requestId: string, recipeId: string) {
    return requireRecipe(await repository.getRecipe(projectId, requestId, recipeId));
  }

  async function agentSubmitRecipe(
    actor: QaActor,
    projectId: string,
    requestId: string,
    input: SubmitQaExecutionRecipeInput
  ) {
    const recipeId = await repository.submitRecipe({
      actor,
      artifactId: input.artifactId,
      bundle: input.bundle,
      origin: "AGENT_PROVIDED",
      profileManifest: input.profileManifest,
      projectId,
      requestId,
      supersedesRecipeId: input.supersedesRecipeId,
      title: input.title,
    });
    const [operation, recipe] = await Promise.all([
      processingRepository.getRequestOperation({
        artifactId: input.artifactId,
        kind: "EXECUTION_RECIPE_REVIEW",
        recipeId,
        requestId,
      }),
      repository.getRecipe(projectId, requestId, recipeId),
    ]);
    return {
      operation: requireOperation(operation),
      recipe: requireRecipe(recipe),
      recipeId,
    };
  }

  return {
    agentGetRecipe,
    agentListRecipes,
    agentSubmitRecipe,
    generateRecipe,
    getRecipe,
    listRecipes,
    retryRecipeReview,
  };
}

export const qaExecutionRecipesService = createQaExecutionRecipesService({
  processingRepository: qaProcessingRepository,
  projectAccess: projectAccessService,
  repository: qaExecutionRecipeRepository,
});

function requireRecipe<T>(recipe: T | null): T {
  if (!recipe) {
    throw new AppError("Execution Recipe was not found.", 404, "QA_EXECUTION_RECIPE_NOT_FOUND");
  }
  return recipe;
}

function requireOperation<T>(operation: T | null): T {
  if (!operation) {
    throw new AppError("QA processing operation was not found.", 404, "QA_OPERATION_NOT_FOUND");
  }
  return operation;
}
