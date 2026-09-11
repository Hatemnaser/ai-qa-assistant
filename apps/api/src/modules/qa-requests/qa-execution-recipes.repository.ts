import { createHash } from "node:crypto";

import {
  profileManifestV1Schema,
  recipeBundleV1Schema,
  type ProfileManifestV1,
  type RecipeBundleV1,
} from "@oddpath/qa-execution-contract";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { validateExecutionEvidenceCompatibility } from "./qa-execution-evidence.js";
import type { QaActor, QaProcessingLease } from "./qa-requests.types.js";
import type {
  QaExecutionRecipeRepository,
  SubmitQaExecutionRecipeCommand,
} from "./qa-execution-recipes.types.js";

const RECIPE_PHASES = new Set(["READY_TO_RUN", "CHANGES_REQUESTED"]);

export function createQaExecutionRecipeRepository(
  database: typeof prisma = prisma
): QaExecutionRecipeRepository {
  return {
    async queueGeneration(input) {
      const profile = resolveProfileManifest(input.profileManifest);
      return database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await tx.qaRequest.findFirst({
          select: { id: true, phase: true, selectedArtifactId: true },
          where: { id: input.requestId, projectId: input.projectId },
        });
        if (!request) throw requestNotFound();
        assertRecipePhase(request.phase);
        const artifactId = input.artifactId || request.selectedArtifactId;
        if (!artifactId || artifactId !== request.selectedArtifactId) {
          throw new AppError(
            "Execution Recipes must target the owner-selected QA Checklist.",
            409,
            "QA_RECIPE_ARTIFACT_NOT_SELECTED"
          );
        }
        const artifact = await loadArtifact(tx, request.id, artifactId);
        validateArtifactEvidence(artifact, profile);
        const execution = await tx.qaGenerationExecution.create({
          data: {
            artifactId,
            kind: "EXECUTION_RECIPE_GENERATION",
            profileManifest: toJson(profile),
            profileManifestHash: profile.manifestHash,
            requestId: request.id,
          },
        });
        await appendEvent(tx, request.id, input.actor, "EXECUTION_RECIPE_GENERATION_QUEUED", {
          artifactId,
          operationId: execution.id,
          profileKey: profile.profileKey,
        });
        return execution.id;
      });
    },

    async queueReviewRetry(input) {
      return database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        if (input.actor.kind !== "USER" || !input.actor.userId) {
          throw new AppError("Only the project owner can retry a Recipe review.", 403, "QA_RECIPE_REVIEW_OWNER_REQUIRED");
        }
        const request = await tx.qaRequest.findFirst({
          select: { id: true, phase: true, selectedArtifactId: true },
          where: {
            id: input.requestId,
            projectId: input.projectId,
            project: { ownerId: input.actor.userId },
          },
        });
        if (!request) throw requestNotFound();
        const recipe = await tx.qaExecutionRecipe.findFirst({
          where: { id: input.recipeId, requestId: request.id, request: { projectId: input.projectId } },
        });
        if (!recipe) throw recipeNotFound();

        // A failed assessment is a single retry intent, including after its retry finishes.
        // Check replay before current-state guards so delayed duplicate clicks cannot bill again.
        const idempotencyKeyHash = hashCanonicalJson({
          assessmentId: input.assessmentId,
          intent: "execution-recipe-review-retry-v1",
          recipeId: recipe.id,
        });
        const replay = await tx.qaGenerationExecution.findFirst({
          select: { id: true },
          where: { idempotencyKeyHash, kind: "EXECUTION_RECIPE_REVIEW", requestId: request.id },
        });
        if (replay) return replay.id;

        assertRecipePhase(request.phase);
        if (recipe.artifactId !== request.selectedArtifactId) {
          throw new AppError(
            "Execution Recipes must target the owner-selected QA Checklist.",
            409,
            "QA_RECIPE_ARTIFACT_NOT_SELECTED"
          );
        }
        const assessment = await tx.qaExecutionRecipeAssessment.findFirst({
          orderBy: { createdAt: "desc" },
          where: { recipeId: recipe.id },
        });
        if (!assessment || assessment.id !== input.assessmentId || assessment.status !== "FAILED") {
          throw new AppError(
            "Only the latest failed Recipe assessment can be retried.",
            409,
            "QA_RECIPE_REVIEW_RETRY_INVALID"
          );
        }
        const active = await tx.qaGenerationExecution.findFirst({
          select: { id: true },
          where: {
            kind: "EXECUTION_RECIPE_REVIEW",
            recipeId: recipe.id,
            requestId: request.id,
            status: { in: ["PENDING", "PROCESSING"] },
          },
        });
        if (active) {
          throw new AppError("A Recipe review is already active.", 409, "QA_RECIPE_REVIEW_IN_PROGRESS");
        }
        // A retry never accepts a replacement profile, Recipe, or approval from the caller.
        const profile = resolveProfileManifest(profileManifestV1Schema.parse(recipe.profileManifest));
        if (profile.manifestHash !== recipe.profileManifestHash) {
          throw new AppError("The stored Runner profile hash is invalid.", 409, "QA_PROFILE_MANIFEST_HASH_INVALID");
        }
        const pending = await tx.qaExecutionRecipeAssessment.create({
          data: {
            // Keep newest-assessment queries unambiguous, even for immediate retries.
            createdAt: new Date(Math.max(Date.now(), assessment.createdAt.getTime() + 1)),
            recipeId: recipe.id,
            status: "PENDING",
            suggestions: toJson([]),
          },
        });
        const operation = await tx.qaGenerationExecution.create({
          data: {
            artifactId: recipe.artifactId,
            idempotencyKeyHash,
            kind: "EXECUTION_RECIPE_REVIEW",
            profileManifest: toJson(recipe.profileManifest),
            profileManifestHash: recipe.profileManifestHash,
            recipeId: recipe.id,
            requestId: request.id,
          },
        });
        await appendEvent(tx, request.id, input.actor, "EXECUTION_RECIPE_REVIEW_RETRIED", {
          assessmentId: pending.id,
          failedAssessmentId: assessment.id,
          operationId: operation.id,
          recipeHash: recipe.recipeHash,
          recipeId: recipe.id,
        });
        return operation.id;
      });
    },

    async submitRecipe(command) {
      const bundle = recipeBundleV1Schema.parse(command.bundle);
      const profile = resolveProfileManifest(command.profileManifest);
      const recipeHash = hashCanonicalJson(bundle);
      return database.$transaction(async (tx) => {
        await lockRequest(tx, command.requestId);
        const request = await tx.qaRequest.findFirst({
          select: { id: true, phase: true, selectedArtifactId: true },
          where: { id: command.requestId, projectId: command.projectId },
        });
        if (!request) throw requestNotFound();
        assertRecipePhase(request.phase);
        if (request.selectedArtifactId !== command.artifactId) {
          throw new AppError(
            "Execution Recipes must target the owner-selected QA Checklist.",
            409,
            "QA_RECIPE_ARTIFACT_NOT_SELECTED"
          );
        }
        const artifact = await loadArtifact(tx, request.id, command.artifactId);
        validateExecutionRecipeCompatibility(bundle, artifact, profile);
        if (command.processing) {
          await assertProcessingLease(tx, {
            ...command.processing,
            artifactId: artifact.id,
            kind: "EXECUTION_RECIPE_GENERATION",
            requestId: request.id,
          });
        }

        const duplicate = await tx.qaExecutionRecipe.findFirst({
          select: { id: true },
          where: { artifactId: artifact.id, recipeHash, profileManifestHash: profile.manifestHash },
        });
        if (duplicate) {
          if (command.processing) {
            await completeGenerationExecution(tx, command.processing, duplicate.id, command);
          }
          return duplicate.id;
        }

        if (command.supersedesRecipeId) {
          const supersedes = await tx.qaExecutionRecipe.findFirst({
            select: { id: true },
            where: { artifactId: artifact.id, id: command.supersedesRecipeId },
          });
          if (!supersedes) {
            throw new AppError(
              "The superseded Execution Recipe was not found.",
              404,
              "QA_EXECUTION_RECIPE_NOT_FOUND"
            );
          }
        }

        const latest = await tx.qaExecutionRecipe.findFirst({
          orderBy: { revision: "desc" },
          select: { revision: true },
          where: { artifactId: artifact.id },
        });
        const recipe = await tx.qaExecutionRecipe.create({
          data: {
            artifactId: artifact.id,
            canonicalJson: toJson(bundle),
            connectionTokenId: command.actor.connectionTokenId || null,
            createdByUserId: command.actor.userId || null,
            executorKey: bundle.engine,
            items: {
              create: bundle.items.map((item, ordinal) => ({
                checklistItemId: item.checklistItemId,
                ordinal,
                recipeHash: hashCanonicalJson(item),
                steps: toJson(item.steps),
              })),
            },
            assessments: { create: { status: "PENDING", suggestions: toJson([]) } },
            model: command.model || null,
            origin: command.origin,
            profileManifest: toJson(profile),
            profileManifestHash: profile.manifestHash,
            provider: command.provider || null,
            recipeHash,
            requestId: request.id,
            revision: (latest?.revision || 0) + 1,
            schemaVersion: bundle.schemaVersion,
            supersedesRecipeId: command.supersedesRecipeId || null,
            title: command.title,
            transport: command.actor.transport,
          },
        });
        await tx.qaGenerationExecution.create({
          data: {
            artifactId: artifact.id,
            kind: "EXECUTION_RECIPE_REVIEW",
            profileManifest: toJson(profile),
            profileManifestHash: profile.manifestHash,
            recipeId: recipe.id,
            requestId: request.id,
          },
        });
        if (command.processing) {
          await completeGenerationExecution(tx, command.processing, recipe.id, command);
        }
        await appendEvent(tx, request.id, command.actor, "EXECUTION_RECIPE_SUBMITTED", {
          artifactId: artifact.id,
          origin: command.origin,
          recipeHash,
          recipeId: recipe.id,
          revision: recipe.revision,
        });
        return recipe.id;
      });
    },

    async completeAssessment(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const recipe = await requireRecipe(tx, input.projectId, input.requestId, input.recipeId);
        await assertProcessingLease(tx, {
          ...input.processing,
          artifactId: recipe.artifactId,
          kind: "EXECUTION_RECIPE_REVIEW",
          recipeId: recipe.id,
          requestId: input.requestId,
        });
        const assessment = await tx.qaExecutionRecipeAssessment.findFirst({
          orderBy: { createdAt: "desc" },
          where: { recipeId: recipe.id },
        });
        if (!assessment || assessment.status !== "PENDING") throw leaseLost();
        await tx.qaExecutionRecipeAssessment.update({
          data: {
            completedAt: new Date(),
            errorCode: null,
            model: input.model || null,
            provider: input.provider || null,
            status: input.status,
            suggestions: toJson(input.suggestions),
            summary: input.summary || null,
          },
          where: { id: assessment.id },
        });
        await finishExecution(tx, input.processing, {
          errorCode: null,
          model: input.model,
          provider: input.provider,
          status: "SUCCEEDED",
        });
        await appendEvent(tx, input.requestId, input.actor, "EXECUTION_RECIPE_ASSESSED", {
          recipeId: recipe.id,
          status: input.status,
          suggestionCount: input.suggestions.length,
        });
      });
    },

    async failAssessment(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const recipe = await requireRecipe(tx, input.projectId, input.requestId, input.recipeId);
        await assertProcessingLease(tx, {
          ...input.processing,
          artifactId: recipe.artifactId,
          kind: "EXECUTION_RECIPE_REVIEW",
          recipeId: recipe.id,
          requestId: input.requestId,
        });
        const assessment = await tx.qaExecutionRecipeAssessment.findFirst({
          orderBy: { createdAt: "desc" },
          where: { recipeId: recipe.id },
        });
        if (!assessment || assessment.status !== "PENDING") throw leaseLost();
        await tx.qaExecutionRecipeAssessment.update({
          data: { completedAt: new Date(), errorCode: input.errorCode, status: "FAILED" },
          where: { id: assessment.id },
        });
        await finishExecution(tx, input.processing, {
          errorCode: input.errorCode,
          status: "FAILED",
        });
        await appendEvent(tx, input.requestId, input.actor, "EXECUTION_RECIPE_ASSESSMENT_FAILED", {
          errorCode: input.errorCode,
          recipeId: recipe.id,
        });
      });
    },

    async failGeneration(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await tx.qaRequest.findFirst({
          select: { id: true },
          where: { id: input.requestId, projectId: input.projectId },
        });
        if (!request) throw requestNotFound();
        await assertProcessingLease(tx, {
          ...input.processing,
          kind: "EXECUTION_RECIPE_GENERATION",
          requestId: request.id,
        });
        await finishExecution(tx, input.processing, {
          errorCode: input.errorCode,
          status: "FAILED",
        });
        await appendEvent(tx, request.id, input.actor, "EXECUTION_RECIPE_GENERATION_FAILED", {
          errorCode: input.errorCode,
          operationId: input.processing.executionId,
        });
      });
    },

    async listRecipes(projectId, requestId) {
      const recipes = await database.qaExecutionRecipe.findMany({
        include: {
          assessments: { orderBy: { createdAt: "desc" } },
          items: { orderBy: { ordinal: "asc" } },
        },
        orderBy: { revision: "desc" },
        where: { requestId, request: { projectId } },
      });
      return recipes.map(toRecipeDto);
    },

    async getRecipe(projectId, requestId, recipeId) {
      const recipe = await database.qaExecutionRecipe.findFirst({
        include: {
          assessments: { orderBy: { createdAt: "desc" } },
          items: { orderBy: { ordinal: "asc" } },
        },
        where: { id: recipeId, requestId, request: { projectId } },
      });
      return recipe ? toRecipeDto(recipe) : null;
    },
  };
}

export const qaExecutionRecipeRepository = createQaExecutionRecipeRepository();

export function resolveProfileManifest(input: ProfileManifestV1) {
  const parsed = profileManifestV1Schema.parse(input);
  const { manifestHash: suppliedHash, ...publicManifest } = parsed;
  const manifestHash = hashCanonicalJson(publicManifest);
  if (suppliedHash && suppliedHash !== manifestHash) {
    throw new AppError(
      "The runner profile manifest hash does not match its contents.",
      409,
      "QA_PROFILE_MANIFEST_HASH_INVALID"
    );
  }
  return { ...publicManifest, manifestHash };
}

export function hashCanonicalJson(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

async function loadArtifact(
  tx: Prisma.TransactionClient,
  requestId: string,
  artifactId: string
) {
  const artifact = await tx.qaArtifact.findFirst({
    include: {
      items: {
        include: { evidenceRequirements: { orderBy: { ordinal: "asc" } } },
        orderBy: { ordinal: "asc" },
      },
    },
    where: { id: artifactId, requestId },
  });
  if (!artifact) {
    throw new AppError("The QA Checklist was not found.", 404, "QA_ARTIFACT_NOT_FOUND");
  }
  return artifact;
}

export function validateExecutionRecipeCompatibility(
  bundle: RecipeBundleV1,
  artifact: {
    items: Array<{
      evidenceRequirements: Array<{
        description: string;
        id: string;
        kind: string;
        required: boolean;
      }>;
      id: string;
      title: string;
    }>;
  },
  profile: ReturnType<typeof resolveProfileManifest>
) {
  validateArtifactEvidence(artifact, profile);
  const artifactIds = artifact.items.map(({ id }) => id).sort();
  const recipeIds = bundle.items.map(({ checklistItemId }) => checklistItemId).sort();
  if (JSON.stringify(artifactIds) !== JSON.stringify(recipeIds)) {
    throw new AppError(
      "The Execution Recipe must cover every checklist item exactly once.",
      409,
      "QA_RECIPE_COVERAGE_INVALID"
    );
  }
  const allowedValueKeys = new Set(profile.valueReferences.map(({ key }) => key));
  for (const key of collectProfileValueKeys(bundle)) {
    if (!allowedValueKeys.has(key)) {
      throw new AppError(
        `The Execution Recipe references an undeclared profile value: ${key}.`,
        409,
        "QA_RECIPE_PROFILE_VALUE_UNDECLARED"
      );
    }
  }
}

function validateArtifactEvidence(
  artifact: {
    items: Array<{
      evidenceRequirements: Array<{
        description: string;
        id: string;
        kind: string;
        required: boolean;
      }>;
      title: string;
    }>;
  },
  profile: ReturnType<typeof resolveProfileManifest>
) {
  validateExecutionEvidenceCompatibility(artifact.items, profile.evidenceKinds);
}

function collectProfileValueKeys(value: unknown, keys = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const child of value) collectProfileValueKeys(child, keys);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.source === "profile" && typeof record.key === "string") keys.add(record.key);
    for (const child of Object.values(record)) collectProfileValueKeys(child, keys);
  }
  return keys;
}

async function completeGenerationExecution(
  tx: Prisma.TransactionClient,
  processing: QaProcessingLease,
  recipeId: string,
  command: Pick<SubmitQaExecutionRecipeCommand, "model" | "provider">
) {
  const updated = await tx.qaGenerationExecution.updateMany({
    data: {
      completedAt: new Date(),
      errorCode: null,
      leaseExpiresAt: null,
      leaseToken: null,
      model: command.model || null,
      provider: command.provider || null,
      recipeId,
      status: "SUCCEEDED",
    },
    where: {
      id: processing.executionId,
      leaseToken: processing.leaseToken,
      status: "PROCESSING",
    },
  });
  if (updated.count !== 1) throw leaseLost();
}

async function finishExecution(
  tx: Prisma.TransactionClient,
  processing: QaProcessingLease,
  result: {
    errorCode: string | null;
    model?: string;
    provider?: string;
    status: "SUCCEEDED" | "FAILED";
  }
) {
  const updated = await tx.qaGenerationExecution.updateMany({
    data: {
      completedAt: new Date(),
      errorCode: result.errorCode,
      leaseExpiresAt: null,
      leaseToken: null,
      model: result.model || null,
      provider: result.provider || null,
      status: result.status,
    },
    where: {
      id: processing.executionId,
      leaseToken: processing.leaseToken,
      status: "PROCESSING",
    },
  });
  if (updated.count !== 1) throw leaseLost();
}

async function assertProcessingLease(
  tx: Prisma.TransactionClient,
  input: QaProcessingLease & {
    artifactId?: string;
    kind: "EXECUTION_RECIPE_GENERATION" | "EXECUTION_RECIPE_REVIEW";
    recipeId?: string;
    requestId: string;
  }
) {
  const execution = await tx.qaGenerationExecution.findFirst({
    select: { id: true },
    where: {
      artifactId: input.artifactId,
      id: input.executionId,
      kind: input.kind,
      leaseExpiresAt: { gt: new Date() },
      leaseToken: input.leaseToken,
      recipeId: input.recipeId,
      requestId: input.requestId,
      status: "PROCESSING",
    },
  });
  if (!execution) throw leaseLost();
}

async function requireRecipe(
  tx: Prisma.TransactionClient,
  projectId: string,
  requestId: string,
  recipeId: string
) {
  const recipe = await tx.qaExecutionRecipe.findFirst({
    select: { artifactId: true, id: true },
    where: { id: recipeId, requestId, request: { projectId } },
  });
  if (!recipe) throw recipeNotFound();
  return recipe;
}

function toRecipeDto(recipe: {
  artifactId: string;
  assessments: Array<{
    completedAt: Date | null;
    createdAt: Date;
    errorCode: string | null;
    id: string;
    model: string | null;
    provider: string | null;
    status: string;
    suggestions: Prisma.JsonValue;
    summary: string | null;
  }>;
  canonicalJson: Prisma.JsonValue;
  createdAt: Date;
  executorKey: string;
  id: string;
  items: Array<{ checklistItemId: string; ordinal: number; steps: Prisma.JsonValue }>;
  origin: string;
  profileManifest: Prisma.JsonValue | null;
  profileManifestHash: string | null;
  recipeHash: string;
  requestId: string;
  revision: number;
  schemaVersion: number;
  supersedesRecipeId: string | null;
  title: string;
}) {
  return {
    artifactId: recipe.artifactId,
    assessments: recipe.assessments.map((assessment) => ({
      ...assessment,
      completedAt: assessment.completedAt?.toISOString() || null,
      createdAt: assessment.createdAt.toISOString(),
    })),
    bundle: recipe.canonicalJson,
    createdAt: recipe.createdAt.toISOString(),
    executorKey: recipe.executorKey,
    id: recipe.id,
    items: recipe.items,
    origin: recipe.origin,
    profileManifest: recipe.profileManifest,
    profileManifestHash: recipe.profileManifestHash,
    recipeHash: recipe.recipeHash,
    requestId: recipe.requestId,
    revision: recipe.revision,
    schemaVersion: recipe.schemaVersion,
    supersedesRecipeId: recipe.supersedesRecipeId,
    title: recipe.title,
  };
}

async function appendEvent(
  tx: Prisma.TransactionClient,
  requestId: string,
  actor: QaActor,
  type: string,
  metadata?: Record<string, unknown>
) {
  const latest = await tx.qaWorkflowEvent.findFirst({
    orderBy: { sequence: "desc" },
    select: { sequence: true },
    where: { requestId },
  });
  await tx.qaWorkflowEvent.create({
    data: {
      actorKind: actor.kind,
      actorUserId: actor.userId || null,
      connectionTokenId: actor.connectionTokenId || null,
      metadata: metadata ? toJson(metadata) : undefined,
      requestId,
      sequence: (latest?.sequence || 0) + 1,
      transport: actor.transport,
      type,
    },
  });
}

async function lockRequest(tx: Prisma.TransactionClient, requestId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${requestId}`}, 0))`;
}

function assertRecipePhase(phase: string) {
  if (!RECIPE_PHASES.has(phase)) {
    throw new AppError(
      "Execution Recipes can be created only after an immutable checklist is selected.",
      409,
      "QA_RECIPE_PHASE_INVALID"
    );
  }
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function requestNotFound() {
  return new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
}

function recipeNotFound() {
  return new AppError("Execution Recipe was not found.", 404, "QA_EXECUTION_RECIPE_NOT_FOUND");
}

function leaseLost() {
  return new AppError(
    "The QA processing lease is no longer current.",
    409,
    "QA_PROCESSING_LEASE_LOST"
  );
}
