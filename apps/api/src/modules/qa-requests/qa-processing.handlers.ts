import { prisma } from "../../db/prisma.js";
import { AppError } from "../../lib/errors.js";
import {
  profileManifestV1Schema,
  recipeBundleV1Schema,
} from "@oddpath/qa-execution-contract";
import { qaChecklistIntelligence } from "./qa-checklist.intelligence.js";
import { qaExecutionRecipeIntelligence } from "./qa-execution-recipe.intelligence.js";
import { qaExecutionRecipeRepository } from "./qa-execution-recipes.repository.js";
import type {
  QaExecutionRecipeGenerator,
  QaExecutionRecipeReviewer,
} from "./qa-execution-recipes.types.js";
import { qaRequestRepository } from "./qa-requests.repository.js";
import { qaChecklistDraftSchema } from "./qa-requests.schema.js";
import type {
  QaActor,
  QaChecklistGenerator,
  QaChecklistReviewer,
  QaRequestRepository,
} from "./qa-requests.types.js";
import type {
  ClaimedQaProcessingJob,
  QaProcessingHandlers,
} from "./qa-processing.types.js";

export interface QaProcessingHandlerDependencies {
  database?: typeof prisma;
  generator?: QaChecklistGenerator;
  recipeGenerator?: QaExecutionRecipeGenerator;
  recipeRepository?: typeof qaExecutionRecipeRepository;
  recipeReviewer?: QaExecutionRecipeReviewer;
  repository?: QaRequestRepository;
  reviewer?: QaChecklistReviewer;
}

export function createQaProcessingHandlers({
  database = prisma,
  generator = qaChecklistIntelligence,
  recipeGenerator = qaExecutionRecipeIntelligence,
  recipeRepository = qaExecutionRecipeRepository,
  recipeReviewer = qaExecutionRecipeIntelligence,
  repository = qaRequestRepository,
  reviewer = qaChecklistIntelligence,
}: QaProcessingHandlerDependencies = {}): QaProcessingHandlers {
  return {
    CHECKLIST_GENERATION: {
      async run(job, signal) {
        const context = await loadContext(database, job);
        const generated = await generator.generate({
          requestId: job.requestId,
          signal,
          snapshot: context.snapshot,
          userId: context.userId,
        });
        await repository.submitChecklist({
          actor: systemActor(),
          checklist: generated.checklist,
          model: generated.model,
          origin: "ODDPATH_GENERATED",
          processing: processingLease(job),
          projectId: context.projectId,
          provider: generated.provider,
          requestId: job.requestId,
        });
      },
      async fail(job, errorCode) {
        const request = await requireRequest(database, job.requestId);
        await repository.failChecklistGeneration({
          actor: systemActor(),
          errorCode,
          processing: processingLease(job),
          projectId: request.projectId,
          requestId: job.requestId,
        });
      },
    },
    CHECKLIST_REVIEW: {
      async run(job, signal) {
        if (!job.artifactId) {
          throw new AppError("Checklist review artifact is missing.", 409, "QA_ARTIFACT_MISSING");
        }
        const context = await loadContext(database, job);
        const artifact = await database.qaArtifact.findFirst({
          select: { canonicalJson: true },
          where: { id: job.artifactId, requestId: job.requestId },
        });
        if (!artifact) {
          throw new AppError("QA checklist was not found.", 404, "QA_ARTIFACT_NOT_FOUND");
        }
        const checklist = qaChecklistDraftSchema.parse(artifact.canonicalJson);
        const assessment = await reviewer.review({
          artifactId: job.artifactId,
          checklist,
          requestId: job.requestId,
          signal,
          snapshot: context.snapshot,
          userId: context.userId,
        });
        await repository.completeChecklistAssessment({
          actor: systemActor(),
          artifactId: job.artifactId,
          model: assessment.model,
          processing: processingLease(job),
          projectId: context.projectId,
          provider: assessment.provider,
          requestId: job.requestId,
          status: assessment.status,
          suggestions: assessment.suggestions,
          summary: assessment.summary,
        });
      },
      async fail(job, errorCode) {
        if (!job.artifactId) {
          throw new AppError("Checklist review artifact is missing.", 409, "QA_ARTIFACT_MISSING");
        }
        const request = await requireRequest(database, job.requestId);
        await repository.failChecklistAssessment({
          actor: systemActor(),
          artifactId: job.artifactId,
          errorCode,
          processing: processingLease(job),
          projectId: request.projectId,
          requestId: job.requestId,
        });
      },
    },
    EXECUTION_RECIPE_GENERATION: {
      async run(job, signal) {
        const context = await loadRecipeContext(database, job);
        const generated = await recipeGenerator.generate({
          artifact: context.artifact,
          profileManifest: context.profileManifest,
          requestId: job.requestId,
          signal,
          snapshot: context.snapshot,
          userId: context.userId,
        });
        await recipeRepository.submitRecipe({
          actor: systemActor(),
          artifactId: context.artifact.id,
          bundle: generated.bundle,
          model: generated.model,
          origin: "ODDPATH_GENERATED",
          processing: processingLease(job),
          profileManifest: context.profileManifest,
          projectId: context.projectId,
          provider: generated.provider,
          requestId: job.requestId,
          title: generated.title,
        });
      },
      async fail(job, errorCode) {
        const request = await requireRequest(database, job.requestId);
        await recipeRepository.failGeneration({
          actor: systemActor(),
          errorCode,
          processing: processingLease(job),
          projectId: request.projectId,
          requestId: job.requestId,
        });
      },
    },
    EXECUTION_RECIPE_REVIEW: {
      async run(job, signal) {
        if (!job.recipeId) {
          throw new AppError("Execution Recipe is missing.", 409, "QA_EXECUTION_RECIPE_NOT_FOUND");
        }
        const context = await loadRecipeContext(database, job);
        const recipe = await database.qaExecutionRecipe.findFirst({
          select: { canonicalJson: true },
          where: { id: job.recipeId, requestId: job.requestId },
        });
        if (!recipe) {
          throw new AppError("Execution Recipe was not found.", 404, "QA_EXECUTION_RECIPE_NOT_FOUND");
        }
        const bundle = recipeBundleV1Schema.parse(recipe.canonicalJson);
        const assessment = await recipeReviewer.review({
          artifact: context.artifact,
          bundle,
          profileManifest: context.profileManifest,
          recipeId: job.recipeId,
          requestId: job.requestId,
          signal,
          snapshot: context.snapshot,
          userId: context.userId,
        });
        await recipeRepository.completeAssessment({
          actor: systemActor(),
          model: assessment.model,
          processing: processingLease(job),
          projectId: context.projectId,
          provider: assessment.provider,
          recipeId: job.recipeId,
          requestId: job.requestId,
          status: assessment.status,
          suggestions: assessment.suggestions,
          summary: assessment.summary,
        });
      },
      async fail(job, errorCode) {
        if (!job.recipeId) {
          throw new AppError("Execution Recipe is missing.", 409, "QA_EXECUTION_RECIPE_NOT_FOUND");
        }
        const request = await requireRequest(database, job.requestId);
        await recipeRepository.failAssessment({
          actor: systemActor(),
          errorCode,
          processing: processingLease(job),
          projectId: request.projectId,
          recipeId: job.recipeId,
          requestId: job.requestId,
        });
      },
    },
  };
}

export const qaProcessingHandlers = createQaProcessingHandlers();

async function loadContext(database: typeof prisma, job: ClaimedQaProcessingJob) {
  const request = await requireRequest(database, job.requestId);
  const snapshot = await database.qaContextSnapshot.findFirst({
    orderBy: { version: "desc" },
    where: { requestId: job.requestId },
  });
  if (!snapshot) {
    throw new AppError("QA context snapshot was not found.", 409, "QA_CONTEXT_MISSING");
  }
  return {
    projectId: request.projectId,
    snapshot: {
      degraded: snapshot.degraded,
      payload: snapshot.payload as Record<string, unknown>,
      payloadHash: snapshot.payloadHash,
      retrievalMode: snapshot.retrievalMode,
      sourceManifest: snapshot.sourceManifest as Record<string, unknown>,
    },
    userId: request.createdByUserId || undefined,
  };
}

async function requireRequest(database: typeof prisma, requestId: string) {
  const request = await database.qaRequest.findUnique({
    select: { createdByUserId: true, projectId: true },
    where: { id: requestId },
  });
  if (!request) throw new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
  return request;
}

async function loadRecipeContext(database: typeof prisma, job: ClaimedQaProcessingJob) {
  if (!job.artifactId) {
    throw new AppError("QA Checklist is missing.", 409, "QA_ARTIFACT_MISSING");
  }
  const [context, artifact] = await Promise.all([
    loadContext(database, job),
    database.qaArtifact.findFirst({
      select: {
        id: true,
        revision: true,
        title: true,
        items: {
          orderBy: { ordinal: "asc" },
          select: {
            clientRef: true,
            evidenceRequirements: {
              orderBy: { ordinal: "asc" },
              select: {
                description: true,
                id: true,
                kind: true,
                required: true,
              },
            },
            expectedResult: true,
            id: true,
            ordinal: true,
            preconditions: true,
            steps: true,
            title: true,
          },
        },
      },
      where: { id: job.artifactId, requestId: job.requestId },
    }),
  ]);
  if (!artifact) {
    throw new AppError("QA Checklist was not found.", 404, "QA_ARTIFACT_NOT_FOUND");
  }
  return {
    ...context,
    artifact,
    profileManifest: profileManifestV1Schema.parse(job.profileManifest),
  };
}

function processingLease(job: ClaimedQaProcessingJob) {
  return { executionId: job.id, leaseToken: job.leaseToken };
}

function systemActor(): QaActor {
  return { kind: "SYSTEM", transport: "SYSTEM" };
}
