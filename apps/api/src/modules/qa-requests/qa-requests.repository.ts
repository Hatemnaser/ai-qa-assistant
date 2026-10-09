import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { assertCurrentTestRequest, lockQaSessionScope } from "../test-sessions/test-sessions.guard.js";
import { nextQaTimelinePosition } from "../chat-history/chat-timeline.js";
import type {
  AddQaEvidenceCommand,
  CreateQaRequestCommand,
  QaActor,
  QaChecklistDraft,
  QaRequestRepository,
  SubmitQaChecklistCommand,
} from "./qa-requests.types.js";

export function createPrismaQaRequestRepository(
  database: typeof prisma = prisma
): QaRequestRepository {
  return {
    async createRequest(command) {
      return database.$transaction(async (tx) => {
        return createQaRequestInTransaction(tx, command);
      });
    },

    async listRequests(input) {
      const rows = await database.qaRequest.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: input.limit,
        where: {
          projectId: input.projectId,
          ...(input.cursor
            ? {
                OR: [
                  { updatedAt: { lt: input.cursor.updatedAt } },
                  { updatedAt: input.cursor.updatedAt, id: { lt: input.cursor.id } },
                ],
              }
            : {}),
        },
      });

      return rows.map((row) => ({
        createdAt: row.createdAt,
        id: row.id,
        objective: row.objective,
        phase: row.phase,
        projectId: row.projectId,
        title: row.title,
        updatedAt: row.updatedAt,
        version: row.version,
      }));
    },

    async getRequest(projectId, requestId) {
      return database.qaRequest.findFirst({
        include: {
          project: { select: { id: true, name: true } },
          contextSnapshots: {
            orderBy: { version: "desc" },
            select: {
              createdAt: true,
              degraded: true,
              id: true,
              payloadHash: true,
              retrievalMode: true,
              schemaVersion: true,
              version: true,
            },
          },
          artifacts: {
            include: {
              assessments: { orderBy: { createdAt: "desc" } },
              items: {
                include: { evidenceRequirements: { orderBy: { ordinal: "asc" } } },
                orderBy: { ordinal: "asc" },
              },
            },
            orderBy: { revision: "desc" },
          },
          executionRecipes: {
            include: {
              assessments: { orderBy: { createdAt: "desc" } },
              items: { orderBy: { ordinal: "asc" } },
            },
            orderBy: { revision: "desc" },
          },
          executions: {
            orderBy: { createdAt: "desc" },
            select: {
              artifactId: true,
              attempts: true,
              availableAt: true,
              completedAt: true,
              createdAt: true,
              errorCode: true,
              id: true,
              kind: true,
              recipeId: true,
              requestId: true,
              status: true,
              updatedAt: true,
            },
          },
          runs: {
            include: {
              executionJob: {
                select: {
                  completedAt: true,
                  createdAt: true,
                  errorCode: true,
                  errorMessage: true,
                  id: true,
                  profileKey: true,
                  recipeId: true,
                  runnerRegistrationId: true,
                  status: true,
                  updatedAt: true,
                },
              },
              evidence: {
                include: {
                  assets: {
                    include: {
                      asset: {
                        select: {
                          declaredMimeType: true,
                          detectedMimeType: true,
                          id: true,
                          originalName: true,
                          readyAt: true,
                          sizeBytes: true,
                          status: true,
                        },
                      },
                    },
                    orderBy: { ordinal: "asc" },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
              results: { orderBy: { checklistItemId: "asc" } },
            },
            orderBy: { createdAt: "desc" },
          },
          reviews: { orderBy: { createdAt: "desc" } },
          events: { orderBy: { sequence: "asc" } },
        },
        where: { id: requestId, projectId },
      });
    },

    async getLatestContextSnapshot(projectId, requestId) {
      const snapshot = await database.qaContextSnapshot.findFirst({
        orderBy: { version: "desc" },
        select: {
          degraded: true,
          payload: true,
          payloadHash: true,
          retrievalMode: true,
          sourceManifest: true,
        },
        where: { requestId, request: { projectId } },
      });

      return snapshot
        ? {
            degraded: snapshot.degraded,
            payload: snapshot.payload as Record<string, unknown>,
            payloadHash: snapshot.payloadHash,
            retrievalMode: snapshot.retrievalMode,
            sourceManifest: snapshot.sourceManifest as Record<string, unknown>,
          }
        : null;
    },

    async startChecklistGeneration(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        if (request.phase !== "GENERATING") throw invalidPhase(request.phase);
        const execution = await tx.qaGenerationExecution.findFirst({
          orderBy: { createdAt: "desc" },
          where: { kind: "CHECKLIST_GENERATION", requestId: request.id },
        });
        if (!execution) throw new AppError("QA generation job was not found.", 409, "QA_GENERATION_MISSING");
        if (execution.status === "SUCCEEDED") return;
        await tx.qaGenerationExecution.update({
          data: {
            attempts: { increment: 1 },
            errorCode: null,
            leaseExpiresAt: null,
            leaseToken: null,
            status: "PROCESSING",
          },
          where: { id: execution.id },
        });
        await appendEvent(tx, request.id, input.actor, "CHECKLIST_GENERATION_STARTED");
      });
    },

    async failChecklistGeneration(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        const execution = input.processing
          ? await assertProcessingLease(tx, {
              ...input.processing,
              kind: "CHECKLIST_GENERATION",
              requestId: request.id,
            })
          : await tx.qaGenerationExecution.findFirst({
              orderBy: { createdAt: "desc" },
              where: { kind: "CHECKLIST_GENERATION", requestId: request.id },
            });
        if (!execution) throw new AppError("QA generation job was not found.", 409, "QA_GENERATION_MISSING");
        await tx.qaGenerationExecution.update({
          data: {
            completedAt: new Date(),
            errorCode: input.errorCode,
            leaseExpiresAt: null,
            leaseToken: null,
            status: "FAILED",
          },
          where: { id: execution.id },
        });
        if (request.phase === "GENERATING") {
          await tx.qaRequest.update({
            data: { phase: "PROCESSING_FAILED", version: { increment: 1 } },
            where: { id: request.id },
          });
        }
        await appendEvent(tx, request.id, input.actor, "CHECKLIST_GENERATION_FAILED", {
          errorCode: input.errorCode,
          stateChanged: request.phase === "GENERATING",
        });
      });
    },

    async submitChecklist(command) {
      return database.$transaction(async (tx) => {
        await lockRequest(tx, command.requestId);
        const request = await getMutableRequest(tx, command.projectId, command.requestId);
        await assertCurrentTestRequest(tx, request, { allowPreparation: Boolean(command.processing), processingExecutionId: command.processing?.executionId });
        await assertChecklistMutable(tx, request.id, request.phase);
        const artifactCount = await tx.qaArtifact.count({ where: { requestId: request.id } });
        if (artifactCount >= DATA_LIMITS.qaArtifactsPerRequest) {
          throw new AppError(
            "This QA request has reached its checklist revision limit.",
            409,
            "QA_ARTIFACT_LIMIT_REACHED"
          );
        }

        if (command.supersedesArtifactId) {
          const superseded = await tx.qaArtifact.findFirst({
            select: { id: true },
            where: { id: command.supersedesArtifactId, requestId: request.id },
          });
          if (!superseded) throw notFound();
        }

        const snapshot = await tx.qaContextSnapshot.findFirst({
          orderBy: { version: "desc" },
          where: { requestId: request.id },
        });
        if (!snapshot) {
          throw new AppError("QA context snapshot was not found.", 409, "QA_CONTEXT_MISSING");
        }

        const latestArtifact = await tx.qaArtifact.findFirst({
          orderBy: { revision: "desc" },
          select: { revision: true },
          where: { requestId: request.id },
        });
        const artifact = await tx.qaArtifact.create({
          data: {
            canonicalJson: toJson(command.checklist),
            origin: command.origin,
            renderedMarkdown: renderChecklistMarkdown(command.checklist),
            requestId: request.id,
            revision: (latestArtifact?.revision || 0) + 1,
            snapshotId: snapshot.id,
            title: command.checklist.title,
            items: {
              create: command.checklist.items.map((item, itemIndex) => ({
                category: item.category || null,
                clientRef: item.clientRef || null,
                expectedResult: item.expectedResult,
                ordinal: itemIndex,
                preconditions: item.preconditions,
                priority: item.priority || null,
                steps: item.steps,
                title: item.title,
                evidenceRequirements: {
                  create: item.evidenceRequirements.map((requirement, requirementIndex) => ({
                    description: requirement.description,
                    kind: requirement.kind,
                    ordinal: requirementIndex,
                    required: requirement.required !== false,
                  })),
                },
              })),
            },
            assessments: {
              create: {
                completedAt: command.origin === "ODDPATH_GENERATED" ? new Date() : null,
                status: command.origin === "ODDPATH_GENERATED" ? "PASSED" : "PENDING",
                suggestions: toJson([]),
                summary: command.origin === "ODDPATH_GENERATED"
                  ? "Generated by Oddpath from the locked project context."
                  : null,
              },
            },
          },
        });

        if (command.origin === "ODDPATH_GENERATED") {
          const execution = command.processing
            ? await assertProcessingLease(tx, {
                ...command.processing,
                kind: "CHECKLIST_GENERATION",
                requestId: request.id,
              })
            : await tx.qaGenerationExecution.findFirst({
                orderBy: { createdAt: "desc" },
                where: { kind: "CHECKLIST_GENERATION", requestId: request.id },
              });
          if (execution) {
            await tx.qaGenerationExecution.update({
              data: {
                artifactId: artifact.id,
                completedAt: new Date(),
                errorCode: null,
                model: command.model || null,
                provider: command.provider || null,
                leaseExpiresAt: null,
                leaseToken: null,
                status: "SUCCEEDED",
              },
              where: { id: execution.id },
            });
          }
        } else {
          await tx.qaGenerationExecution.create({
            data: {
              artifactId: artifact.id,
              kind: "CHECKLIST_REVIEW",
              requestId: request.id,
              status: "PENDING",
            },
          });
        }

        await tx.qaRequest.update({
          data: command.origin === "ODDPATH_GENERATED"
            ? { phase: "READY_TO_RUN", selectedArtifactId: artifact.id, version: { increment: 1 } }
            : { phase: "CHECKLIST_REVIEW", selectedArtifactId: null, version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, command.actor, "CHECKLIST_SUBMITTED", {
          artifactId: artifact.id,
          origin: command.origin,
          revision: artifact.revision,
          supersedesArtifactId: command.supersedesArtifactId || null,
        });
        return artifact.id;
      });
    },

    async completeChecklistAssessment(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        const artifact = await tx.qaArtifact.findFirst({
          select: { id: true },
          where: { id: input.artifactId, requestId: request.id },
        });
        if (!artifact) throw notFound();
        if (input.processing) {
          await assertProcessingLease(tx, {
            ...input.processing,
            artifactId: artifact.id,
            kind: "CHECKLIST_REVIEW",
            requestId: request.id,
          });
        }
        const assessment = await tx.qaChecklistAssessment.findFirst({
          orderBy: { createdAt: "desc" },
          where: { artifactId: artifact.id },
        });
        if (!assessment) throw notFound();
        await tx.qaChecklistAssessment.update({
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
        await tx.qaGenerationExecution.updateMany({
          data: {
            completedAt: new Date(),
            errorCode: null,
            model: input.model || null,
            provider: input.provider || null,
            leaseExpiresAt: null,
            leaseToken: null,
            status: "SUCCEEDED",
          },
          where: input.processing
            ? { id: input.processing.executionId, leaseToken: input.processing.leaseToken, status: "PROCESSING" }
            : {
                artifactId: artifact.id,
                kind: "CHECKLIST_REVIEW",
                requestId: request.id,
                status: { in: ["PENDING", "PROCESSING"] },
              },
        });
        await tx.qaRequest.update({
          data: { version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "CHECKLIST_ASSESSED", {
          artifactId: artifact.id,
          status: input.status,
          suggestionCount: input.suggestions.length,
        });
      });
    },

    async failChecklistAssessment(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        const assessment = await tx.qaChecklistAssessment.findFirst({
          orderBy: { createdAt: "desc" },
          where: { artifactId: input.artifactId, artifact: { requestId: request.id } },
        });
        if (!assessment) throw notFound();
        if (input.processing) {
          await assertProcessingLease(tx, {
            ...input.processing,
            artifactId: input.artifactId,
            kind: "CHECKLIST_REVIEW",
            requestId: request.id,
          });
        }
        await tx.qaChecklistAssessment.update({
          data: {
            completedAt: new Date(),
            errorCode: input.errorCode,
            status: "FAILED",
          },
          where: { id: assessment.id },
        });
        await tx.qaGenerationExecution.updateMany({
          data: {
            completedAt: new Date(),
            errorCode: input.errorCode,
            leaseExpiresAt: null,
            leaseToken: null,
            status: "FAILED",
          },
          where: input.processing
            ? { id: input.processing.executionId, leaseToken: input.processing.leaseToken, status: "PROCESSING" }
            : {
                artifactId: input.artifactId,
                kind: "CHECKLIST_REVIEW",
                requestId: request.id,
                status: { in: ["PENDING", "PROCESSING"] },
              },
        });
        await tx.qaRequest.update({
          data: { version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "CHECKLIST_ASSESSMENT_FAILED", {
          artifactId: input.artifactId,
          errorCode: input.errorCode,
        });
      });
    },

    async selectArtifact(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        await assertCurrentTestRequest(tx, request);
        if (request.version !== input.expectedRequestVersion) throw staleVersion();
        await assertChecklistMutable(tx, request.id, request.phase);
        const artifact = await tx.qaArtifact.findFirst({
          include: { assessments: { orderBy: { createdAt: "desc" }, take: 1 } },
          where: { id: input.artifactId, requestId: request.id },
        });
        if (!artifact) throw notFound();
        if (artifact.assessments[0]?.status === "PENDING") {
          throw new AppError(
            "Checklist assessment is still processing.",
            409,
            "QA_CHECKLIST_ASSESSMENT_PENDING"
          );
        }
        await tx.qaRequest.update({
          data: { phase: "READY_TO_RUN", selectedArtifactId: artifact.id, version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "CHECKLIST_SELECTED", {
          artifactId: artifact.id,
          assessmentStatus: artifact.assessments[0]?.status || null,
        });
      });
    },

    async startRun(input) {
      return database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        if (!request.selectedArtifactId) {
          throw new AppError(
            "The project owner must select a checklist before starting a run.",
            409,
            "OWNER_SELECTION_REQUIRED"
          );
        }
        if (input.externalRunRef) {
          const existingRun = await tx.qaRun.findFirst({
            where: { externalRunRef: input.externalRunRef, requestId: request.id },
          });
          if (existingRun) {
            const sameIntent =
              existingRun.artifactId === request.selectedArtifactId &&
              existingRun.commitSha === (input.commitSha || null) &&
              existingRun.sourceLabel === (input.sourceLabel || null);
            if (!sameIntent) {
              throw new AppError(
                "External run reference was already used with different run details.",
                409,
                "EXTERNAL_RUN_REFERENCE_CONFLICT"
              );
            }
            return existingRun.id;
          }
        }
        await assertCurrentTestRequest(tx, request);
        if (!new Set(["READY_TO_RUN", "CHANGES_REQUESTED"]).has(request.phase)) {
          throw invalidPhase(request.phase);
        }
        const runCount = await tx.qaRun.count({ where: { requestId: request.id } });
        if (runCount >= DATA_LIMITS.qaRunsPerRequest) {
          throw new AppError(
            "This QA request has reached its run limit.",
            409,
            "QA_RUN_LIMIT_REACHED"
          );
        }
        const activeRun = await tx.qaRun.findFirst({
          select: { id: true },
          where: { requestId: request.id, status: { in: ["CREATED", "ACTIVE"] } },
        });
        if (activeRun) {
          throw new AppError("A QA run is already active.", 409, "QA_RUN_ALREADY_ACTIVE");
        }
        const now = new Date();
        await tx.qaArtifact.updateMany({
          data: { lockedAt: now },
          where: { id: request.selectedArtifactId, lockedAt: null },
        });
        const run = await tx.qaRun.create({
          data: {
            artifactId: request.selectedArtifactId,
            commitSha: input.commitSha || null,
            externalRunRef: input.externalRunRef || null,
            requestId: request.id,
            sourceLabel: input.sourceLabel || null,
            startedAt: now,
            status: "ACTIVE",
          },
        });
        await tx.qaRequest.update({
          data: { phase: "RUNNING", version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "RUN_STARTED", {
          artifactId: request.selectedArtifactId,
          runId: run.id,
          sourceLabel: input.sourceLabel || null,
        });
        return run.id;
      });
    },

    async recordCheckResult(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        const run = await tx.qaRun.findFirst({
          where: { id: input.runId, requestId: request.id },
        });
        if (!run) throw notFound();
        assertGenericRunMutationAllowed(run);
        if (run.status !== "ACTIVE") throw invalidRunStatus(run.status);
        if (run.version !== input.expectedVersion) throw staleVersion();
        const item = await tx.qaChecklistItem.findFirst({
          select: { id: true },
          where: { artifactId: run.artifactId, id: input.checklistItemId },
        });
        if (!item) throw notFound();
        await tx.qaCheckResult.upsert({
          create: {
            checklistItemId: item.id,
            notes: input.notes || null,
            observedResult: input.observedResult || null,
            runId: run.id,
            status: input.status,
          },
          update: {
            notes: input.notes || null,
            observedResult: input.observedResult || null,
            status: input.status,
          },
          where: { runId_checklistItemId: { checklistItemId: item.id, runId: run.id } },
        });
        await tx.qaRun.update({ data: { version: { increment: 1 } }, where: { id: run.id } });
        await appendEvent(tx, request.id, input.actor, "CHECK_RESULT_RECORDED", {
          checklistItemId: item.id,
          runId: run.id,
          status: input.status,
        });
      });
    },

    async addEvidence(command) {
      return database.$transaction(async (tx) => addEvidence(tx, command));
    },

    async finishRun(input) {
      await database.$transaction(async (tx) => {
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        const run = await tx.qaRun.findFirst({
          where: { id: input.runId, requestId: request.id },
        });
        if (!run) throw notFound();
        assertGenericRunMutationAllowed(run);
        if (run.status !== "ACTIVE") throw invalidRunStatus(run.status);
        if (run.version !== input.expectedVersion) throw staleVersion();
        const [items, results] = await Promise.all([
          tx.qaChecklistItem.count({ where: { artifactId: run.artifactId } }),
          tx.qaCheckResult.findMany({ where: { runId: run.id } }),
        ]);
        if (results.length !== items) {
          throw new AppError(
            `${items - results.length} checklist result(s) are still missing.`,
            422,
            "QA_RESULTS_INCOMPLETE"
          );
        }
        const outcome = calculateOutcome(results.map((result) => result.status));
        const missingEvidence = await countMissingEvidence(tx, run.id, run.artifactId);
        const phase = missingEvidence === 0 ? "READY_FOR_REVIEW" : "EVIDENCE_NEEDED";
        await tx.qaRun.update({
          data: {
            outcome,
            status: "RESULTS_SUBMITTED",
            submittedAt: new Date(),
            version: { increment: 1 },
          },
          where: { id: run.id },
        });
        await tx.qaRequest.update({
          data: { phase, version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "RUN_RESULTS_SUBMITTED", {
          missingEvidence,
          outcome,
          runId: run.id,
        });
      });
    },

    async reviewRun(input) {
      await database.$transaction(async (tx) => {
        if (input.actor.kind !== "USER" || !input.actor.userId) {
          throw new AppError("Only the project owner can review a QA record.", 403, "QA_REVIEW_FORBIDDEN");
        }
        await lockRequest(tx, input.requestId);
        const request = await getMutableRequest(tx, input.projectId, input.requestId);
        if (request.phase !== "READY_FOR_REVIEW") throw invalidPhase(request.phase);
        const run = await tx.qaRun.findFirst({
          where: { id: input.runId, requestId: request.id },
        });
        if (!run) throw notFound();
        await assertCurrentRun(tx, request.id, run.id);
        if (run.status !== "RESULTS_SUBMITTED") throw invalidRunStatus(run.status);
        if (run.version !== input.expectedRunVersion) throw staleVersion();
        if (request.selectedArtifactId !== run.artifactId) throw staleVersion();
        const missingEvidence = await countMissingEvidence(tx, run.id, run.artifactId);
        if (input.decision === "APPROVED" && missingEvidence > 0) {
          throw new AppError(
            `${missingEvidence} required evidence item(s) are missing.`,
            422,
            "EVIDENCE_REQUIRED"
          );
        }
        await tx.qaHumanReview.create({
          data: {
            artifactId: run.artifactId,
            comment: input.comment || null,
            decision: input.decision,
            requestId: request.id,
            reviewerUserId: input.actor.userId,
            runId: run.id,
            runVersion: run.version,
          },
        });
        await tx.qaRequest.update({
          data: {
            phase: input.decision === "APPROVED" ? "APPROVED" : "CHANGES_REQUESTED",
            version: { increment: 1 },
          },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "HUMAN_REVIEW_RECORDED", {
          decision: input.decision,
          runId: run.id,
          runVersion: run.version,
        });
      });
    },
  };
}

export const qaRequestRepository = createPrismaQaRequestRepository();

async function addEvidence(tx: Prisma.TransactionClient, command: AddQaEvidenceCommand) {
  await lockRequest(tx, command.requestId);
  const request = await getMutableRequest(tx, command.projectId, command.requestId);
  if (request.phase === "APPROVED" || request.phase === "CANCELLED") throw invalidPhase(request.phase);
  const run = await tx.qaRun.findFirst({ where: { id: command.runId, requestId: request.id } });
  // Active execution evidence belongs to the leased Runner protocol. Keep the
  // existing post-submission supplementation flow once execution has finished.
  if (run && (run.status === "CREATED" || run.status === "ACTIVE")) {
    assertGenericRunMutationAllowed(run);
  }
  if (!run || !new Set(["ACTIVE", "RESULTS_SUBMITTED"]).has(run.status)) throw notFound();
  await assertCurrentRun(tx, request.id, run.id);
  const evidenceCount = await tx.qaEvidence.count({ where: { runId: run.id } });
  if (evidenceCount >= DATA_LIMITS.qaEvidencePerRun) {
    throw new AppError("This QA run has reached its evidence limit.", 409, "QA_EVIDENCE_LIMIT_REACHED");
  }

  if (command.checklistItemId) {
    const item = await tx.qaChecklistItem.findFirst({
      select: { id: true },
      where: { artifactId: run.artifactId, id: command.checklistItemId },
    });
    if (!item) throw notFound();
  }
  if (command.requirementId) {
    const requirement = await tx.qaEvidenceRequirement.findFirst({
      select: { checklistItemId: true, kind: true },
      where: { id: command.requirementId, checklistItem: { artifactId: run.artifactId } },
    });
    if (!requirement || (command.checklistItemId && requirement.checklistItemId !== command.checklistItemId)) {
      throw notFound();
    }
    if (requirement.kind !== command.kind) {
      throw new AppError(
        `This evidence requirement expects ${requirement.kind} evidence.`,
        422,
        "QA_EVIDENCE_KIND_MISMATCH"
      );
    }
  }

  const uniqueAssetIds = [...new Set(command.assetIds)].sort();
  if (uniqueAssetIds.length > 0) {
    if (!command.actor.userId) throw new AppError("Asset owner is required.", 403, "QA_EVIDENCE_FORBIDDEN");
    for (const assetId of uniqueAssetIds) await lockAsset(tx, assetId);
    const assets = await tx.storedAsset.findMany({
      select: {
        id: true,
        ownerId: true,
        projectId: true,
        purpose: true,
        qaEvidenceAsset: { select: { id: true } },
        status: true,
      },
      where: { id: { in: uniqueAssetIds } },
    });
    if (
      assets.length !== uniqueAssetIds.length ||
      assets.some((asset) =>
        asset.ownerId !== command.actor.userId ||
        asset.projectId !== command.projectId ||
        asset.purpose !== "QA_EVIDENCE" ||
        asset.status !== "READY" ||
        Boolean(asset.qaEvidenceAsset)
      )
    ) {
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }
  }

  const evidence = await tx.qaEvidence.create({
    data: {
      actorKind: command.actor.kind,
      checklistItemId: command.checklistItemId || null,
      connectionTokenId: command.actor.connectionTokenId || null,
      createdByUserId: command.actor.userId || null,
      externalReference: command.externalReference || null,
      kind: command.kind,
      metadata: command.metadata ? toJson(command.metadata) : undefined,
      requirementId: command.requirementId || null,
      runId: run.id,
      textContent: command.textContent || null,
      transport: command.actor.transport,
      assets: {
        create: uniqueAssetIds.map((assetId, ordinal) => ({ assetId, ordinal })),
      },
    },
  });
  await tx.qaRun.update({ data: { version: { increment: 1 } }, where: { id: run.id } });
  if (run.status === "RESULTS_SUBMITTED") {
    const missingEvidence = await countMissingEvidence(tx, run.id, run.artifactId);
    await tx.qaRequest.update({
      data: {
        phase: missingEvidence === 0 ? "READY_FOR_REVIEW" : "EVIDENCE_NEEDED",
        version: { increment: 1 },
      },
      where: { id: request.id },
    });
  }
  await appendEvent(tx, request.id, command.actor, "EVIDENCE_ADDED", {
    evidenceId: evidence.id,
    kind: command.kind,
    runId: run.id,
  });
  return evidence.id;
}

async function countMissingEvidence(
  tx: Prisma.TransactionClient,
  runId: string,
  artifactId: string
) {
  const requirements = await tx.qaEvidenceRequirement.findMany({
    select: { id: true },
    where: { checklistItem: { artifactId }, required: true },
  });
  if (requirements.length === 0) return 0;
  const fulfilled = await tx.qaEvidence.findMany({
    distinct: ["requirementId"],
    select: { requirementId: true },
    where: { requirementId: { in: requirements.map(({ id }) => id) }, runId },
  });
  return requirements.length - new Set(fulfilled.map(({ requirementId }) => requirementId)).size;
}

function assertGenericRunMutationAllowed(run: { executionRecipeId: string | null }) {
  if (run.executionRecipeId) {
    throw new AppError(
      "Use the assigned Runner protocol to mutate this Playwright execution.",
      409,
      "QA_EXECUTION_PROTOCOL_REQUIRED"
    );
  }
}

async function assertCurrentRun(
  tx: Prisma.TransactionClient,
  requestId: string,
  runId: string
) {
  const currentRun = await tx.qaRun.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
    where: { requestId },
  });
  if (currentRun?.id !== runId) {
    throw new AppError(
      "This QA run was superseded by a newer run.",
      409,
      "QA_RUN_SUPERSEDED"
    );
  }
}

async function assertProcessingLease(
  tx: Prisma.TransactionClient,
  input: {
    artifactId?: string;
    executionId: string;
    kind: "CHECKLIST_GENERATION" | "CHECKLIST_REVIEW";
    leaseToken: string;
    requestId: string;
  }
) {
  const execution = await tx.qaGenerationExecution.findFirst({
    where: {
      id: input.executionId,
      kind: input.kind,
      leaseExpiresAt: { gt: new Date() },
      leaseToken: input.leaseToken,
      requestId: input.requestId,
      status: "PROCESSING",
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    },
  });
  if (!execution) {
    throw new AppError(
      "The QA processing lease is no longer current.",
      409,
      "QA_PROCESSING_LEASE_LOST"
    );
  }
  return execution;
}

async function getMutableRequest(tx: Prisma.TransactionClient, projectId: string, requestId: string) {
  const request = await tx.qaRequest.findFirst({ where: { id: requestId, projectId } });
  if (!request) throw notFound();
  return request;
}

async function assertChecklistMutable(
  tx: Prisma.TransactionClient,
  requestId: string,
  phase: string
) {
  if (new Set(["APPROVED", "CANCELLED", "RUNNING", "EVIDENCE_NEEDED", "READY_FOR_REVIEW", "CHANGES_REQUESTED"]).has(phase)) {
    throw new AppError("The QA checklist is locked.", 409, "CHECKLIST_LOCKED");
  }
  const runCount = await tx.qaRun.count({ where: { requestId } });
  if (runCount > 0) throw new AppError("The QA checklist is locked.", 409, "CHECKLIST_LOCKED");
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
      timelinePosition: await nextQaTimelinePosition(tx, requestId),
      transport: actor.transport,
      type,
    },
  });
}

async function lockRequest(tx: Prisma.TransactionClient, requestId: string) {
  await lockQaSessionScope(tx, requestId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${requestId}`}, 0))`;
}

export async function createQaRequestInTransaction(tx: Prisma.TransactionClient, command: CreateQaRequestCommand) {
  await lockProjectQuota(tx, command.projectId);
  const count = await tx.qaRequest.count({ where: { projectId: command.projectId } });
  if (count >= DATA_LIMITS.qaRequestsPerProject) {
    throw new AppError(`A project can contain up to ${DATA_LIMITS.qaRequestsPerProject} QA requests.`, 409, "QA_REQUEST_LIMIT_REACHED");
  }
  const request = await tx.qaRequest.create({ data: {
    acceptanceNotes: command.acceptanceNotes || null,
    createdByUserId: command.actor.userId || null,
    environment: command.environment || null,
    objective: command.objective,
    phase: command.checklistMode === "ODDPATH_GENERATED" ? "GENERATING" : "DRAFT",
    projectId: command.projectId,
    target: command.target || null,
    title: command.title,
    ...(command.testSessionId ? { testSessionId: command.testSessionId } : {}),
    contextSnapshots: { create: {
      degraded: command.snapshot.degraded,
      payload: toJson(command.snapshot.payload),
      payloadHash: command.snapshot.payloadHash,
      retrievalMode: command.snapshot.retrievalMode,
      sourceManifest: toJson(command.snapshot.sourceManifest),
      version: 1,
    } },
  } });
  if (command.checklistMode === "ODDPATH_GENERATED") {
    await tx.qaGenerationExecution.create({ data: {
      idempotencyKeyHash: command.idempotencyKeyHash || null,
      kind: "CHECKLIST_GENERATION",
      requestId: request.id,
    } });
  }
  await appendEvent(tx, request.id, command.actor, "REQUEST_CREATED", { checklistMode: command.checklistMode });
  return request.id;
}

async function lockProjectQuota(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:qa-requests:${projectId}`}, 0))`;
}

async function lockAsset(tx: Prisma.TransactionClient, assetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
}

function calculateOutcome(statuses: string[]) {
  if (statuses.includes("FAIL")) return "FAIL" as const;
  if (statuses.includes("BLOCKED")) return "BLOCKED" as const;
  if (statuses.includes("SKIPPED")) return "INCOMPLETE" as const;
  return "PASS" as const;
}

function renderChecklistMarkdown(checklist: QaChecklistDraft) {
  return [
    `# ${checklist.title}`,
    ...checklist.items.flatMap((item, index) => [
      "",
      `## ${index + 1}. ${item.title}`,
      ...item.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
      "",
      `Expected: ${item.expectedResult}`,
    ]),
  ].join("\n");
}

function toJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function notFound() {
  return new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
}

function staleVersion() {
  return new AppError("The QA record changed. Reload and try again.", 409, "STALE_VERSION");
}

function invalidPhase(phase: string) {
  return new AppError(`QA request cannot perform this action in ${phase}.`, 409, "QA_PHASE_INVALID");
}

function invalidRunStatus(status: string) {
  return new AppError(`QA run cannot perform this action in ${status}.`, 409, "QA_RUN_STATUS_INVALID");
}
