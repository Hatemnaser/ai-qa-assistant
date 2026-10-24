import { createHash, randomUUID } from "node:crypto";

import {
  executionTaskV1Schema,
  executionTaskV2Schema,
  executionBindingV2Schema,
  hasQaEvidenceContent,
  profileManifestSchema,
  recipeBundleV1Schema,
  type ExecutionTaskV2,
} from "@oddpath/qa-execution-contract";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { env } from "../../config/env.js";
import { hashCanonicalJson } from "../../lib/canonical-json.js";
import { requireApprovedTarget, requireCurrentTargetVerification } from "../qa-targets/qa-targets.execution.js";
import { requireSavedAuthentication } from '../browser-auth/browser-auth.authority.js';
import type { BrowserAuthVault } from '../browser-auth/browser-auth.vault.js';
import { prisma } from "../../db/prisma.js";
import {requireManagedAdmission} from '../browser-runtime/managed-project-identity.js';
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { reserveBrowser,grantBrowser,requireBrowserReservation,reconcileBrowserReservations } from '../browser-runtime/browser-reservations.js';
import { assertCurrentTestRequest, lockQaSessionScope } from "../test-sessions/test-sessions.guard.js";
import { nextQaTimelinePosition } from "../chat-history/chat-timeline.js";
import { selectExecutableEvidenceRequirements } from "./qa-execution-evidence.js";
import { availableEvidenceWhere, createQaProvenance, evidenceAssetSnapshot } from "./qa-evidence-provenance.js";
import { resolveProfileManifest } from "./qa-execution-recipes.repository.js";
import type {
  QaExecutionLease,
  QaExecutionRepository,
} from "./qa-execution.types.js";
import type { QaActor } from "./qa-requests.types.js";

const ACTIVE_JOB_STATUSES = ["CLAIMED", "RUNNING"] as const;
const ONLINE_WINDOW_MS = 90_000;
const EXECUTION_DEADLINE_MS = 30 * 60_000;
const MAX_JOB_ATTEMPTS = 3;
const MAX_JOB_RECONCILIATIONS_PER_CLAIM = 4;

export function createQaExecutionRepository(
  database: typeof prisma = prisma,
  now: () => Date = () => new Date(),
  options: { allowV2?: boolean; requireRuntime?: boolean; allowLegacyDispatch?: boolean; allowManualLogin?: boolean; savedVault?: BrowserAuthVault; enforceBrowserQuota?:boolean } = {}
): QaExecutionRepository {
  return {
    async start(input) {
      return database.$transaction(async (tx) => {
        if (options.requireRuntime ?? env.qaBrowserRuntimeEnabled) await requireLegacyDrain(tx);
        await lockRequest(tx, input.requestId);
        const request = await tx.qaRequest.findFirst({
          where: { id: input.requestId, projectId: input.projectId },
        });
        if (!request) throw requestNotFound();
        await assertCurrentTestRequest(tx, request);
        if (request.version !== input.expectedRequestVersion) throw staleVersion();
        if (!request.selectedArtifactId) {
          throw new AppError(
            "The project owner must select a checklist before starting a run.",
            409,
            "OWNER_SELECTION_REQUIRED"
          );
        }
        if (!new Set(["READY_TO_RUN", "CHANGES_REQUESTED"]).has(request.phase)) {
          throw invalidPhase(request.phase);
        }
        const recipe = await tx.qaExecutionRecipe.findFirst({
          include: { assessments: { orderBy: { createdAt: "desc" }, take: 1 } },
          where: {
            artifactId: request.selectedArtifactId,
            id: input.recipeId,
            requestId: request.id,
          },
        });
        if (!recipe) throw recipeNotFound();
        if (recipe.recipeHash !== input.recipeHash) {
          throw new AppError(
            "The approved Execution Recipe changed. Review it again before running.",
            409,
            "QA_RECIPE_HASH_MISMATCH"
          );
        }
        const assessment = recipe.assessments[0];
        if (!assessment || assessment.status === "PENDING") {
          throw new AppError(
            "Execution Recipe assessment is still processing.",
            409,
            "QA_RECIPE_ASSESSMENT_PENDING"
          );
        }
        if (assessment.status === "FAILED") {
          throw new AppError(
            "Execution Recipe assessment failed. Open Run with Playwright and choose Retry review.",
            409,
            "QA_RECIPE_ASSESSMENT_FAILED"
          );
        }
        const runner = await tx.qaRunnerRegistration.findFirst({
          where: {
            id: input.runnerRegistrationId,
            projectId: input.projectId,
            connectionToken: {
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
            },
          },
        });
        if (!runner) throw runnerNotFound();
        await requireManagedAdmission(tx,runner.connectionTokenId,now);
        if (now().getTime() - runner.lastSeenAt.getTime() > ONLINE_WINDOW_MS) {
          throw new AppError("The selected Runner is offline.", 409, "QA_RUNNER_OFFLINE");
        }
        const profile = selectProfile(runner.publicProfiles, input.profileKey);
        if (profile.schemaVersion === 1 && !(options.allowLegacyDispatch ?? env.qaLegacyRunnerDispatchEnabled)) {
          throw new AppError("Legacy Runner dispatch is disabled. Review a new managed recipe and approval.", 409, "QA_LEGACY_DISPATCH_DISABLED");
        }
        if (profile.schemaVersion === 2 && !(options.allowV2 ?? env.qaExecutionV2Enabled)) {
          throw new AppError("Protocol v2 dispatch is not active. Runtime supervision and Stop gates are pending.", 409, "QA_EXECUTION_V2_NOT_ACTIVE");
        }
        if (!runner.protocolVersions.includes(profile.schemaVersion) || !runner.executorKeys.includes(recipe.executorKey)) {
          throw new AppError(
            "The selected Runner is incompatible with this Recipe.",
            409,
            "QA_RUNNER_INCOMPATIBLE"
          );
        }
        if (
          !recipe.profileManifestHash
          || profile.manifestHash !== recipe.profileManifestHash
        ) {
          throw new AppError(
            "The Runner profile changed after this Recipe was created. Generate or submit a new Recipe revision.",
            409,
            "QA_PROFILE_MANIFEST_CHANGED"
          );
        }
        if (profile.environmentKind === "PRODUCTION" && !input.confirmProduction) {
          throw new AppError(
            "Production execution requires explicit confirmation.",
            409,
            "QA_PRODUCTION_CONFIRMATION_REQUIRED"
          );
        }
        let verification: Awaited<ReturnType<typeof requireApprovedTarget>> | undefined;
        if (profile.schemaVersion === 2) {
          if ((profile.authentication.kind === "SAVED_STATE" && !(options.savedVault||env.qaSavedLoginEnabled)) || (profile.authentication.kind === "MANUAL" && !(options.allowManualLogin ?? env.qaManualLoginEnabled))) throw new AppError("Browser authentication is not active for this profile.", 409, "QA_BROWSER_AUTH_NOT_ACTIVE");
          if (profile.environmentKind === "PRODUCTION" && recipeBundleV1Schema.parse(recipe.canonicalJson).items.some(({ steps }) => steps.some(({ action }) => !["navigate", "expect"].includes(action)))) {
            throw new AppError("Production v2 recipes permit navigation and assertions only.", 409, "QA_PRODUCTION_RECIPE_ACTION_BLOCKED");
          }
          verification = await requireApprovedTarget(tx, input.projectId, profile, now);
          await requireSavedAuthentication(tx,input.projectId,profile,now,options.savedVault);
          requireCurrentTargetVerification(verification,now());
        }
        const [runCount, activeRun] = await Promise.all([
          tx.qaRun.count({ where: { requestId: request.id } }),
          tx.qaRun.findFirst({
            select: { id: true },
            where: { requestId: request.id, status: { in: ["CREATED", "ACTIVE"] } },
          }),
        ]);
        if (runCount >= DATA_LIMITS.qaRunsPerRequest) {
          throw new AppError(
            "This QA request has reached its run limit.",
            409,
            "QA_RUN_LIMIT_REACHED"
          );
        }
        if (activeRun) {
          throw new AppError("A QA run is already active.", 409, "QA_RUN_ALREADY_ACTIVE");
        }
        const savedAuthentication=profile.schemaVersion===2?await requireSavedAuthentication(tx,input.projectId,profile,now,options.savedVault):null;
        const startedAt = now();
        if (verification) requireCurrentTargetVerification(verification, startedAt);
        const deadlineAt = new Date(startedAt.getTime() + (profile.schemaVersion === 2 ? profile.executionLimits.executionTimeoutMs
          + (profile.authentication.kind !== "NONE" ? profile.executionLimits.preparationTimeoutMs : 0) : EXECUTION_DEADLINE_MS));
        if(savedAuthentication&&savedAuthentication.expiresAt<deadlineAt)deadlineAt.setTime(savedAuthentication.expiresAt.getTime());
        const authorizationId = randomUUID();
        const binding = profile.schemaVersion === 2 ? {
          id: authorizationId,
          approvedAt: startedAt.toISOString(), expiresAt: deadlineAt.toISOString(),
          requestVersion: request.version, artifactId: request.selectedArtifactId,
          recipeId: recipe.id, recipeHash: recipe.recipeHash, profileManifestHash: profile.manifestHash,
          targetRevisionId: profile.target.revisionId, targetHash: profile.target.targetHash,
          verificationId: verification!.id, authentication: profile.authentication,
          executionLimits: profile.executionLimits, candidate: profile.target.candidate,
        } : null;
        await tx.qaArtifact.updateMany({
          data: { lockedAt: startedAt },
          where: { id: request.selectedArtifactId, lockedAt: null },
        });
        await tx.qaExecutionRecipe.updateMany({
          data: { lockedAt: startedAt },
          where: { id: recipe.id, lockedAt: null },
        });
        const run = await tx.qaRun.create({
          data: {
            artifactId: request.selectedArtifactId,
            executionRecipeId: recipe.id,
            requestId: request.id,
            sourceLabel: "Oddpath Playwright",
            startedAt,
            status: "ACTIVE",
          },
        });
        const authorization = await tx.qaExecutionAuthorization.create({
          data: {
            id: authorizationId,
            approvedByUserId: input.actor.userId || null,
            artifactId: request.selectedArtifactId,
            productionConfirmed: profile.environmentKind === "PRODUCTION",
            profileKey: profile.profileKey,
            profileManifestHash: profile.manifestHash,
            recipeHash: recipe.recipeHash,
            recipeId: recipe.id,
            runId: run.id,
            runnerRegistrationId: runner.id,
            ...(binding ? {
              protocolVersion: 2, requestVersion: request.version,
              targetRevisionId: binding.targetRevisionId, targetHash: binding.targetHash,
              verificationId: binding.verificationId, bindingHash: hashCanonicalJson(binding),
              binding: binding as Prisma.InputJsonValue, expiresAt: deadlineAt, approvedAt: startedAt,
            } : {}),
          },
        });
        const job = await tx.qaExecutionJob.create({
          data: {
            artifactId: request.selectedArtifactId,
            authorizationId: authorization.id,
            deadlineAt,
            protocolVersion: profile.schemaVersion,
            executorKey: recipe.executorKey,
            profileKey: profile.profileKey,
            profileManifestHash: profile.manifestHash,
            projectId: input.projectId,
            recipeHash: recipe.recipeHash,
            recipeId: recipe.id,
            requestId: request.id,
            runId: run.id,
            runnerRegistrationId: runner.id,
          },
        });
        if(profile.schemaVersion===2&&options.enforceBrowserQuota!==false){
          const owner=await tx.project.findUniqueOrThrow({where:{id:input.projectId},select:{ownerId:true}});
          await reserveBrowser(tx,job.id,owner.ownerId,deadlineAt,now);
          if(verification)requireCurrentTargetVerification(verification,now());
          if(deadlineAt<=now())throw executionApprovalInvalid();
        }
        await tx.qaRequest.update({
          data: { phase: "RUNNING", version: { increment: 1 } },
          where: { id: request.id },
        });
        await appendEvent(tx, request.id, input.actor, "RUN_STARTED", {
          artifactId: request.selectedArtifactId,
          executionMode: "PLAYWRIGHT",
          recipeId: recipe.id,
          runId: run.id,
        });
        await appendEvent(tx, request.id, input.actor, "EXECUTION_QUEUED", {
          executionId: job.id,
          profileKey: profile.profileKey,
          runnerRegistrationId: runner.id,
        });
        return { executionId: job.id, runId: run.id };
      });
    },

    async claim(input) {
      return database.$transaction(async (tx) => {
        if (options.requireRuntime ?? env.qaBrowserRuntimeEnabled) await requireLegacyDrain(tx);
        const registration = await tx.qaRunnerRegistration.findFirst({
          select: { id: true, instanceId: true, projectId: true },
          where: {
            connectionTokenId: input.connectionTokenId,
            id: input.request.registrationId,
            instanceId: input.request.instanceId,
          },
        });
        if (!registration) throw runnerNotFound();
        let claimedAt = now();
        if ((input.protocolVersion ?? 1) === 1 && !(options.allowLegacyDispatch ?? env.qaLegacyRunnerDispatchEnabled)) return null;
        if (input.protocolVersion === 2 && !(options.allowV2 ?? env.qaExecutionV2Enabled)) return null;
        for (
          let reconciliation = 0;
          reconciliation < MAX_JOB_RECONCILIATIONS_PER_CLAIM;
          reconciliation += 1
        ) {
          const reconciled = await reconcileUnclaimableJob(
            tx,
            registration.id,
            claimedAt,
            input.actor
          );
          if (!reconciled) break;
        }
        const candidate = await tx.qaExecutionJob.findFirst({
          orderBy: input.protocolVersion===2&&options.enforceBrowserQuota!==false ? [{browserReservation:{queuedAt:'asc'}},{id:'asc'}] : [{ availableAt: "asc" }, { createdAt: "asc" }],
          select: { deadlineAt: true, id: true, requestId: true },
          where: {
            attempts: { lt: MAX_JOB_ATTEMPTS },
            deadlineAt: { gt: claimedAt },
            runnerRegistrationId: registration.id,
            protocolVersion: input.protocolVersion ?? 1,
            OR: [
              { availableAt: { lte: claimedAt }, status: "QUEUED" },
              ...(input.protocolVersion === 2 ? [] : [{
                leaseExpiresAt: { lte: claimedAt },
                status: { in: [...ACTIVE_JOB_STATUSES] },
              }]),
            ],
          },
        });
        if (!candidate) return null;
        await lockRequest(tx, candidate.requestId);
        await requireManagedAdmission(tx,input.connectionTokenId,now);
        const current=await tx.qaExecutionJob.findUnique({where:{id:candidate.id}});
        if(!current||(current.status!=='QUEUED'&&input.protocolVersion===2))return null;
        if(input.protocolVersion===2&&options.enforceBrowserQuota!==false){
          const grant=await grantBrowser(tx,candidate.id,now);
          if(grant==='WAITING')return null;
          if(grant==='EXPIRED'){
            await terminalizeExecutionFailure(tx,current,input.actor,{code:'BROWSER_QUEUE_EXPIRED',message:'Browser queue wait expired. Review and approve a new run.'},now());
            return null;
          }
        }
        claimedAt=now();
        if(candidate.deadlineAt<=claimedAt||input.leaseExpiresAt<=claimedAt){
          await terminalizeExecutionFailure(tx,current,input.actor,{code:'QA_EXECUTION_LEASE_LOST',message:'Execution lease expired while waiting for capacity.'},claimedAt);return null;
        }
        const claimId = randomUUID();
        const leaseExpiresAt = earlierDate(input.leaseExpiresAt, candidate.deadlineAt);
        const updated = await tx.qaExecutionJob.updateMany({
          data: {
            attempts: { increment: 1 },
            claimId,
            errorCode: null,
            errorMessage: null,
            lastHeartbeatAt: claimedAt,
            leaseExpiresAt,
            leaseTokenHash: hashLeaseToken(input.leaseToken),
            runnerInstanceId: registration.instanceId,
            status: "CLAIMED",
          },
          where: {
            id: candidate.id,
            attempts: { lt: MAX_JOB_ATTEMPTS },
            deadlineAt: { gt: claimedAt },
            runnerRegistrationId: registration.id,
            protocolVersion: input.protocolVersion ?? 1,
            OR: [
              { availableAt: { lte: claimedAt }, status: "QUEUED" },
              ...(input.protocolVersion === 2 ? [] : [{
                leaseExpiresAt: { lte: claimedAt },
                status: { in: [...ACTIVE_JOB_STATUSES] },
              }]),
            ],
          },
        });
        if (updated.count !== 1) return null;
        const job = await loadJobTask(tx, candidate.id);
        let task;
        try {
          task = toExecutionTask(job, claimedAt);
          if (task.schemaVersion === 2) task = (await recheckV2ExecutionAuthority(tx, job, task, now,options.savedVault)).task;
        } catch (error) {
          if (!isExecutionApprovalError(error)) throw error;
          await terminalizeExecutionFailure(tx, job, input.actor, error, now());
          return null;
        }
        await appendEvent(tx, job.requestId, input.actor, "EXECUTION_CLAIMED", {
          claimId,
          executionId: job.id,
          runnerInstanceId: registration.instanceId,
        });
        return {
          claim: {
            artifactId: job.artifact.id,
            artifactRevision: job.artifact.revision,
            claimId,
            executionId: job.id,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            leaseToken: input.leaseToken,
            recipeHash: job.recipeHash,
          },
          task,
        };
      });
    },

    async accept(input) {
      const result = await database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        let acceptedAt: Date | undefined;
        try {
          const approvedJob = await loadJobTask(tx, job.id);
          const profile = resolveApprovedExecutionProfile(approvedJob);
          if (profile.schemaVersion === 2) {
            if(options.enforceBrowserQuota!==false)await requireBrowserReservation(tx,job.id);
            if ((options.requireRuntime ?? env.qaBrowserRuntimeEnabled)
              && (!approvedJob.browserRuntime || approvedJob.browserRuntime.state !== "LIVE" || approvedJob.browserRuntime.claimId !== input.lease.claimId)) {
              throw new AppError("A live managed runtime must be bound before acceptance.", 409, "QA_EXECUTION_APPROVAL_INVALID");
            }
            if (profile.authentication.kind === 'MANUAL' && (!(options.allowManualLogin ?? env.qaManualLoginEnabled)
              || !approvedJob.browserRuntime || approvedJob.browserRuntime.loginPhase !== 'READY')) {
              throw new AppError('Human preparation must finish before accepting execution.', 409, 'QA_EXECUTION_APPROVAL_INVALID');
            }
            const task = toExecutionTask(approvedJob, now());
            if(profile.authentication.kind==='SAVED_STATE'&&(!approvedJob.browserRuntime||approvedJob.browserRuntime.loginPhase!=='READY'))throw executionApprovalInvalid();
            if (task.schemaVersion === 2) acceptedAt = (await recheckV2ExecutionAuthority(tx, approvedJob, task, now,options.savedVault)).decisionAt;
          }
        } catch (error) {
          if (!isExecutionApprovalError(error)) throw error;
          await terminalizeExecutionFailure(tx, job, input.actor, error, now());
          return { error };
        }
        if (job.status === "CLAIMED") {
          await tx.qaExecutionJob.update({
            data: { acceptedAt: acceptedAt ?? now(), status: "RUNNING" },
            where: { id: job.id },
          });
          await appendEvent(tx, job.requestId, input.actor, "EXECUTION_STARTED", {
            executionId: job.id,
          });
        }
        return { receipt: executionReceipt(job, "RUNNING", job.leaseExpiresAt) };
      });
      // Commit the terminal failure before rejecting acceptance. Returning a failed
      // receipt would let a Runner that expects acceptance continue into the browser.
      if (result.error) throw result.error;
      return result.receipt;
    },

    async heartbeat(input) {
      return database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if(job.protocolVersion===2){const approvedJob=await loadJobTask(tx,job.id),profile=resolveApprovedExecutionProfile(approvedJob);if(profile.schemaVersion===2)await requireSavedAuthentication(tx,job.projectId,profile,now,options.savedVault);}
        const heartbeatAt = now();
        if(!job.leaseExpiresAt||job.leaseExpiresAt<=heartbeatAt||job.deadlineAt<=heartbeatAt)throw leaseLost();
        const leaseExpiresAt = earlierDate(input.leaseExpiresAt, job.deadlineAt);
        const updated = await tx.qaExecutionJob.updateMany({
          data: { lastHeartbeatAt: heartbeatAt, leaseExpiresAt },
          where: { id: job.id, status: { in: [...ACTIVE_JOB_STATUSES] } },
        });
        if (updated.count !== 1) throw leaseLost();
        return executionReceipt(
          job,
          job.status === "RUNNING" ? "RUNNING" : "CLAIMED",
          leaseExpiresAt
        );
      });
    },

    async prepareEvidenceUpload(input) {
      await database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if (job.status !== "RUNNING") throw invalidExecutionStatus(job.status);
        const requirement = await tx.qaEvidenceRequirement.findFirst({
          select: { id: true },
          where: {
            checklistItemId: input.checklistItemId,
            id: input.requirementId,
            kind: "SCREENSHOT",
            checklistItem: { artifactId: job.artifactId },
          },
        });
        if (!requirement) {
          throw new AppError(
            "Screenshot evidence requirement was not found.",
            404,
            "QA_EVIDENCE_REQUIREMENT_NOT_FOUND"
          );
        }
      });
    },

    async reserveEvidenceUpload(input) {
      await database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if (job.status !== "RUNNING") throw invalidExecutionStatus(job.status);
        const [requirement, asset] = await Promise.all([
          tx.qaEvidenceRequirement.findFirst({
            select: { id: true },
            where: {
              checklistItemId: input.checklistItemId,
              id: input.requirementId,
              kind: "SCREENSHOT",
              checklistItem: { artifactId: job.artifactId },
            },
          }),
          tx.storedAsset.findFirst({
            select: { id: true },
            where: {
              id: input.assetId,
              projectId: job.projectId,
              purpose: "QA_EVIDENCE",
              status: "PENDING",
            },
          }),
        ]);
        if (!requirement) {
          throw new AppError(
            "Screenshot evidence requirement was not found.",
            404,
            "QA_EVIDENCE_REQUIREMENT_NOT_FOUND"
          );
        }
        if (!asset) throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
        await tx.qaExecutionEvidenceUpload.create({
          data: {
            assetId: asset.id,
            checklistItemId: input.checklistItemId,
            executionJobId: job.id,
            requirementId: requirement.id,
          },
        });
      });
    },

    async assertEvidenceUpload(input) {
      await database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if (job.status !== "RUNNING") throw invalidExecutionStatus(job.status);
        const upload = await tx.qaExecutionEvidenceUpload.findFirst({
          select: { id: true },
          where: { assetId: input.assetId, consumedAt: null, executionJobId: job.id },
        });
        if (!upload) {
          throw new AppError("Execution evidence upload was not found.", 404, "QA_EXECUTION_UPLOAD_NOT_FOUND");
        }
      });
    },

    async recordItem(input) {
      return database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if (job.status !== "RUNNING") throw invalidExecutionStatus(job.status);
        const run = await tx.qaRun.findFirst({
          where: { id: job.runId, requestId: job.requestId },
        });
        if (!run || run.status !== "ACTIVE") throw invalidRunStatus(run?.status || "MISSING");
        if (run.version !== input.submission.expectedRunVersion) throw staleVersion();
        const item = await tx.qaChecklistItem.findFirst({
          include: { evidenceRequirements: true },
          where: { artifactId: job.artifactId, id: input.checklistItemId },
        });
        if (!item) {
          throw new AppError("Checklist item was not found.", 404, "QA_CHECKLIST_ITEM_NOT_FOUND");
        }
        const evidenceCount = await tx.qaEvidence.count({ where: { runId: run.id } });
        if (evidenceCount + input.submission.evidence.length > DATA_LIMITS.qaEvidencePerRun) {
          throw new AppError("This QA run has reached its evidence limit.", 409, "QA_EVIDENCE_LIMIT_REACHED");
        }
        const recipe = await tx.qaExecutionRecipe.findFirst({select: {profileManifest: true, items: true}, where: {id: job.recipeId}});
        const authorization = await tx.qaExecutionAuthorization.findUnique({where: {id: job.authorizationId}});
        const profile = recipe ? resolveProfileManifest(profileManifestSchema.parse(recipe.profileManifest)) : null;
        const observation = input.submission.observation;
        if (observation) {
          const steps = (recipe?.items.find(row => row.checklistItemId === item.id)?.steps || []) as Array<{ref: string; action: string}>;
          const completed = observation.completedStepRefs;
          const next = steps[completed.length];
          if (!steps.length || completed.some((ref, index) => steps[index]?.ref !== ref)
            || (input.submission.status === "PASS" ? completed.length !== steps.length || observation.failedStepRef !== null
              : !next || observation.failedStepRef !== next.ref || (input.submission.status === "FAIL" && next.action !== "expect"))
            || Date.parse(observation.finishedAt) > now().getTime() + 30_000
            || (job.acceptedAt && Date.parse(observation.startedAt) < job.acceptedAt.getTime() - 30_000)) {
            throw new AppError("Observation does not match the approved recipe.", 422, "QA_OBSERVATION_INVALID");
          }
        }
        const request = await tx.qaRequest.findFirst({where: {id: job.requestId, projectId: job.projectId}});
        const provenance = createQaProvenance({actor: input.actor, projectId: job.projectId, requestId: job.requestId, runId: run.id,
          artifactId: job.artifactId, item, target: profile?.schemaVersion === 2 ? profile.target.baseUrl : request?.target, environment: profile?.environmentKind || request?.environment,
          commitSha: profile?.schemaVersion === 2 ? profile.target.candidate?.reference : run.commitSha,
          targetRevisionId: authorization?.targetRevisionId, targetHash: authorization?.targetHash, recipeHash: job.recipeHash,
          registrationId: job.runnerRegistrationId, observation, recordedAt: now()});
        await tx.qaCheckResult.upsert({
          create: {
            checklistItemId: item.id,
            notes: input.submission.notes || null,
            observedResult: input.submission.observedResult,
            runId: run.id,
            status: input.submission.status,
            provenance: provenance as Prisma.InputJsonValue,
          },
          update: {
            notes: input.submission.notes || null,
            observedResult: input.submission.observedResult,
            status: input.submission.status,
            provenance: provenance as Prisma.InputJsonValue,
          },
          where: { runId_checklistItemId: { checklistItemId: item.id, runId: run.id } },
        });
        const requirements = new Map(item.evidenceRequirements.map((requirement) => [requirement.id, requirement]));
        for (const evidence of input.submission.evidence) {
          const requirement = evidence.requirementId ? requirements.get(evidence.requirementId) : null;
          if (evidence.requirementId && !requirement) {
            throw new AppError("Evidence requirement was not found.", 404, "QA_EVIDENCE_REQUIREMENT_NOT_FOUND");
          }
          if (requirement && requirement.kind !== evidence.kind) {
            throw new AppError("Evidence kind does not match the requirement.", 409, "QA_EVIDENCE_KIND_MISMATCH");
          }
          if (evidence.kind === "TEXT") {
            await tx.qaEvidence.create({
              data: {
                actorKind: input.actor.kind,
                checklistItemId: item.id,
                connectionTokenId: input.actor.connectionTokenId || null,
                kind: "TEXT",
                requirementId: evidence.requirementId,
                runId: run.id,
                textContent: evidence.textContent,
                provenance: provenance as Prisma.InputJsonValue,
                transport: input.actor.transport,
              },
            });
            continue;
          }
          if (!evidence.requirementId) {
            throw new AppError(
              "Screenshot evidence must target a checklist requirement.",
              409,
              "QA_EVIDENCE_REQUIREMENT_REQUIRED"
            );
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${evidence.assetId}`}, 0))`;
          const upload = await tx.qaExecutionEvidenceUpload.findFirst({
            include: { asset: true },
            where: {
              assetId: evidence.assetId,
              checklistItemId: item.id,
              consumedAt: null,
              executionJobId: job.id,
              requirementId: evidence.requirementId,
            },
          });
          if (
            !upload
            || upload.asset.projectId !== job.projectId
            || upload.asset.purpose !== "QA_EVIDENCE"
            || upload.asset.status !== "READY"
            || (upload.asset.evidenceExpiresAt && upload.asset.evidenceExpiresAt <= now())
          ) {
            throw new AppError("Screenshot upload is not ready for this execution.", 409, "QA_EXECUTION_UPLOAD_NOT_READY");
          }
          const storedEvidence = await tx.qaEvidence.create({
            data: {
              actorKind: input.actor.kind,
              checklistItemId: item.id,
              connectionTokenId: input.actor.connectionTokenId || null,
              kind: "SCREENSHOT",
              requirementId: evidence.requirementId,
              runId: run.id,
              transport: input.actor.transport,
              provenance: provenance as Prisma.InputJsonValue,
            },
          });
          await tx.qaEvidenceAsset.create({
            data: { assetId: evidence.assetId, evidenceId: storedEvidence.id, ordinal: 0, snapshot: evidenceAssetSnapshot(upload.asset) },
          });
          await tx.qaExecutionEvidenceUpload.update({
            data: { consumedAt: now() },
            where: { id: upload.id },
          });
        }
        const nextRun = await tx.qaRun.update({
          data: { version: { increment: 1 } },
          where: { id: run.id },
        });
        await appendEvent(tx, job.requestId, input.actor, "CHECK_RESULT_RECORDED", {
          checklistItemId: item.id,
          executionId: job.id,
          runId: run.id,
          status: input.submission.status,
        });
        return executionReceipt(job, "RUNNING", job.leaseExpiresAt, nextRun.version);
      });
    },

    async finish(input) {
      return database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        if (job.status !== "RUNNING") throw invalidExecutionStatus(job.status);
        const run = await tx.qaRun.findFirst({ where: { id: job.runId, requestId: job.requestId } });
        if (!run || run.status !== "ACTIVE") throw invalidRunStatus(run?.status || "MISSING");
        if (run.version !== input.finish.expectedRunVersion) throw staleVersion();
        const [itemCount, results] = await Promise.all([
          tx.qaChecklistItem.count({ where: { artifactId: run.artifactId } }),
          tx.qaCheckResult.findMany({ where: { runId: run.id } }),
        ]);
        if (results.length !== itemCount) {
          throw new AppError(
            `${itemCount - results.length} checklist result(s) are still missing.`,
            422,
            "QA_RESULTS_INCOMPLETE"
          );
        }
        const outcome = calculateOutcome(results.map(({ status }) => status));
        const missingEvidence = await countMissingEvidence(tx, run.id, run.artifactId, now());
        const phase = missingEvidence === 0 ? "READY_FOR_REVIEW" : "EVIDENCE_NEEDED";
        const completedAt = now();
        const nextRun = await tx.qaRun.update({
          data: {
            outcome,
            status: "RESULTS_SUBMITTED",
            submittedAt: completedAt,
            version: { increment: 1 },
          },
          where: { id: run.id },
        });
        await tx.qaRequest.update({
          data: { phase, version: { increment: 1 } },
          where: { id: job.requestId },
        });
        await tx.qaExecutionJob.update({
          data: {
            completedAt,
            errorCode: null,
            errorMessage: null,
            leaseExpiresAt: null,
            leaseTokenHash: null,
            status: "SUCCEEDED",
          },
          where: { id: job.id },
        });
        await appendEvent(tx, job.requestId, input.actor, "RUN_RESULTS_SUBMITTED", {
          executionId: job.id,
          missingEvidence,
          outcome,
          runId: run.id,
        });
        return executionReceipt(job, "SUCCEEDED", null, nextRun.version, phase);
      });
    },

    async fail(input) {
      return database.$transaction(async (tx) => {
        const job = await lockAndRequireLease(tx, input, now);
        const run = await terminalizeExecutionFailure(
          tx,
          job,
          input.actor,
          input.failure,
          now()
        );
        return executionReceipt(job, "FAILED", null, run.version, "READY_TO_RUN");
      });
    },

    async cancel(input) {
      await database.$transaction(async (tx) => {
        const candidate = await tx.qaExecutionJob.findFirst({
          select: { requestId: true },
          where: {
            projectId: input.projectId,
            requestId: input.requestId,
            runId: input.runId,
          },
        });
        if (!candidate) throw executionNotFound();
        await lockRequest(tx, candidate.requestId);
        const job = await tx.qaExecutionJob.findFirst({
          include: { run: true },
          where: {
            projectId: input.projectId,
            requestId: input.requestId,
            runId: input.runId,
          },
        });
        if (!job) throw executionNotFound();
        await cancelLockedExecution(tx, job, input.actor, now());
      });
    },
  };
}

export const qaExecutionRepository = createQaExecutionRepository();

// Callers must hold the project/session/request lifecycle locks. Owner logout
// and the existing QA cancel adapter share the same terminal state and history.
export async function cancelLockedExecution(
  tx: Prisma.TransactionClient,
  job: { id: string; requestId: string; runId: string; protocolVersion: number; status: string },
  actor: QaActor,
  cancelledAt: Date
) {
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) return;
  if (job.protocolVersion === 2) await tx.qaBrowserRuntime.updateMany({
    where: { executionId: job.id, state: "LIVE" },
    data: { state: "STOP_REQUESTED", stopRequestedAt: cancelledAt },
  });
  await tx.qaExecutionJob.update({
    data: { completedAt: cancelledAt, leaseExpiresAt: null, leaseTokenHash: null, status: "CANCELLED" },
    where: { id: job.id },
  });
  await tx.qaRun.update({ data: { status: "CANCELLED", version: { increment: 1 } }, where: { id: job.runId } });
  await tx.qaRequest.update({ data: { phase: "READY_TO_RUN", version: { increment: 1 } }, where: { id: job.requestId } });
  await appendEvent(tx, job.requestId, actor, "EXECUTION_CANCELLED", { executionId: job.id, runId: job.runId });
}

async function requireLegacyDrain(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'oddpath:qa-protocol-transition'},0))`;
  const pending = await tx.qaExecutionJob.count({ where: { protocolVersion: 1, status: { in: ['QUEUED', ...ACTIVE_JOB_STATUSES] } } });
  if (pending) throw new AppError('Drain active legacy runs and invalidate unexecuted legacy approvals before managed dispatch.', 409, 'QA_LEGACY_DRAIN_REQUIRED');
}

// Operator-only transition. Disabling legacy dispatch preserves historical
// readers and in-flight receipts. Queued approvals cannot silently become v2.
export async function invalidateQueuedLegacyExecutions(database: typeof prisma = prisma, now = () => new Date()) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'oddpath:qa-protocol-transition'},0))`;
    const active = await tx.qaExecutionJob.count({ where: { status: { in: [...ACTIVE_JOB_STATUSES] } } });
    if (active) throw new AppError('Wait for active executions to drain before invalidating queued legacy approvals.', 409, 'QA_LEGACY_DRAIN_REQUIRED');
    const candidates = await tx.qaExecutionJob.findMany({ where: { protocolVersion: 1, status: 'QUEUED' }, take: 20, orderBy: { id: 'asc' }, select: { id: true, requestId: true } });
    let invalidated = 0;
    for (const candidate of candidates) {
      await lockRequest(tx, candidate.requestId);
      const job = await tx.qaExecutionJob.findUnique({ where: { id: candidate.id } });
      if (!job || job.protocolVersion !== 1 || job.status !== 'QUEUED') continue;
      await terminalizeExecutionFailure(tx, job, { kind: 'SYSTEM', transport: 'SYSTEM' }, {
        code: 'LEGACY_APPROVAL_RENEWAL_REQUIRED', message: 'This unexecuted legacy approval was retired during the managed protocol transition. Review a new recipe and approval.',
      }, now());
      invalidated++;
    }
    return invalidated;
  });
}

// Run in a separately supervised process, not the HTTP server or Runner poll.
export async function reapV2Executions(database: typeof prisma = prisma, now = () => new Date()) {
  const candidates = await database.qaExecutionJob.findMany({ take: 20, orderBy: { deadlineAt: 'asc' },
    where: { protocolVersion: 2, status: { in: ['QUEUED', ...ACTIVE_JOB_STATUSES] }, OR: [
      { deadlineAt: { lte: now() } },
      {status:'QUEUED',browserReservation:{is:{OR:[{state:'RELEASED'},{queueExpiresAt:{lte:now()}}]}}},
      { status: { in: [...ACTIVE_JOB_STATUSES] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now() } }] },
    ] }, select: { id: true, requestId: true } });
  let reaped = 0;
  for (const candidate of candidates) {
    reaped += await database.$transaction(async tx => {
      await lockRequest(tx, candidate.requestId);
      const job = await tx.qaExecutionJob.findUnique({ where: { id: candidate.id },include:{browserReservation:true} });
      if (!job || job.protocolVersion !== 2) return 0;
      const currentTime = now(), failure = job.status==='QUEUED'&&job.browserReservation&&(job.browserReservation.state==='RELEASED'||job.browserReservation.queueExpiresAt<=currentTime)
        ? {code:'BROWSER_QUEUE_EXPIRED',message:'Browser queue wait expired. Review and approve a new run.'}:unclaimableJobFailure(job, currentTime);
      if (!failure) return 0;
      await terminalizeExecutionFailure(tx, job, { kind: 'SYSTEM', transport: 'SYSTEM' }, failure, currentTime);
      await tx.qaBrowserRuntime.updateMany({ where: { executionId: job.id, state: 'LIVE' }, data: { state: 'STOP_REQUESTED', stopRequestedAt: currentTime } });
      await reconcileBrowserReservations(tx,now);
      return 1;
    });
  }
  await database.$transaction(tx=>reconcileBrowserReservations(tx,now));
  return reaped;
}

async function loadJobTask(tx: Prisma.TransactionClient, executionId: string) {
  const job = await tx.qaExecutionJob.findUnique({
    include: {
      authorization: true,
      artifact: {
        include: {
          items: {
            include: { evidenceRequirements: { orderBy: { ordinal: "asc" } } },
            orderBy: { ordinal: "asc" },
          },
        },
      },
      recipe: true,
      request: true,
      run: true,
      runnerRegistration: true,
      browserRuntime: true,
    },
    where: { id: executionId },
  });
  if (!job) throw executionNotFound();
  return job;
}

function toExecutionTask(job: Awaited<ReturnType<typeof loadJobTask>>, currentTime: Date) {
  const profile = resolveApprovedExecutionProfile(job);
  const parsedBundle = recipeBundleV1Schema.safeParse(job.recipe.canonicalJson);
  if (!parsedBundle.success && profile.schemaVersion === 2) throw executionApprovalInvalid();
  const bundle = parsedBundle.success ? parsedBundle.data : recipeBundleV1Schema.parse(job.recipe.canonicalJson);
  const task = {
    artifact: {
      id: job.artifact.id,
      items: job.artifact.items.map((item) => ({
        clientRef: item.clientRef,
        evidenceRequirements: selectExecutableEvidenceRequirements(
          item.evidenceRequirements,
          profile.evidenceKinds
        )
          .map((requirement) => ({
            description: requirement.description,
            id: requirement.id,
            kind: requirement.kind,
            required: requirement.required,
          })),
        expectedResult: item.expectedResult,
        id: item.id,
        ordinal: item.ordinal,
        title: item.title,
      })),
      revision: job.artifact.revision,
      title: job.artifact.title,
    },
    deadlineAt: job.deadlineAt.toISOString(),
    executionId: job.id,
    profile,
    projectId: job.projectId,
    recipe: {
      bundle,
      hash: job.recipeHash,
      id: job.recipe.id,
      revision: job.recipe.revision,
    },
    requestId: job.requestId,
    runId: job.runId,
    runVersion: job.run.version,
    schemaVersion: profile.schemaVersion,
  };
  if (profile.schemaVersion === 1) return executionTaskV1Schema.parse(task);
  const parsedBinding = executionBindingV2Schema.safeParse(job.authorization.binding);
  if (!parsedBinding.success) throw executionApprovalInvalid();
  const binding = parsedBinding.data;
  if (
    hashCanonicalJson(binding) !== job.authorization.bindingHash
    || job.authorization.protocolVersion !== 2
    || job.authorization.targetRevisionId !== profile.target.revisionId
    || job.authorization.targetHash !== profile.target.targetHash
    || !job.authorization.expiresAt || job.authorization.expiresAt <= currentTime
    || (job.protocolVersion ?? 1) !== 2
    || job.request.version !== binding.requestVersion + 1
    || job.request.selectedArtifactId !== binding.artifactId
    || hashCanonicalJson(bundle) !== job.recipeHash) throw executionApprovalInvalid();
  const raw = binding;
  if (raw.id !== job.authorization.id || raw.requestVersion !== job.authorization.requestVersion
    || raw.verificationId !== job.authorization.verificationId
    || raw.approvedAt !== job.authorization.approvedAt.toISOString()
    || raw.expiresAt !== job.authorization.expiresAt.toISOString()
    || hashCanonicalJson(raw.authentication) !== hashCanonicalJson(profile.authentication)
    || hashCanonicalJson(raw.executionLimits) !== hashCanonicalJson(profile.executionLimits)
    || hashCanonicalJson(raw.candidate) !== hashCanonicalJson(profile.target.candidate)) throw executionApprovalInvalid();
  const { authentication: _authentication, executionLimits: _limits, candidate: _candidate, ...approval } = raw;
  const parsedTask = executionTaskV2Schema.safeParse({ ...task, approval: { ...approval, bindingHash: job.authorization.bindingHash } });
  if (!parsedTask.success) throw executionApprovalInvalid();
  return parsedTask.data;
}

async function recheckV2ExecutionAuthority(
  tx: Prisma.TransactionClient,
  job: Awaited<ReturnType<typeof loadJobTask>>,
  task: ExecutionTaskV2,
  now: () => Date,
  savedVault?: BrowserAuthVault
) {
  const verification = await requireApprovedTarget(tx, job.projectId, task.profile, now, task.approval.verificationId);
  await requireSavedAuthentication(tx,job.projectId,task.profile,now,savedVault);
  // Authorization locks and reads are complete. Use one fresh time for approval, proof,
  // execution/lease deadlines and the timestamp that grants acceptance.
  const decisionAt = now();
  const currentTask = toExecutionTask(job, decisionAt);
  requireCurrentTargetVerification(verification, decisionAt);
  if (job.deadlineAt <= decisionAt) throw executionApprovalInvalid();
  if (!job.leaseExpiresAt || job.leaseExpiresAt <= decisionAt) throw leaseLost();
  return { task: currentTask, decisionAt };
}

function resolveApprovedExecutionProfile(job: Awaited<ReturnType<typeof loadJobTask>>) {
  const parsed = profileManifestSchema.safeParse(job.recipe.profileManifest);
  if (!parsed.success) throw executionApprovalInvalid();
  let profile;
  try {
    profile = resolveProfileManifest(parsed.data);
  } catch {
    throw executionApprovalInvalid();
  }
  const authorization = job.authorization;
  if (
    profile.manifestHash !== job.profileManifestHash
    || profile.manifestHash !== job.recipe.profileManifestHash
    || profile.manifestHash !== authorization.profileManifestHash
    || profile.profileKey !== job.profileKey
    || profile.profileKey !== authorization.profileKey
    || authorization.runId !== job.runId
    || authorization.recipeId !== job.recipeId
    || authorization.artifactId !== job.artifactId
    || authorization.runnerRegistrationId !== job.runnerRegistrationId
    || authorization.recipeHash !== job.recipeHash
    || job.recipe.recipeHash !== job.recipeHash
  ) {
    throw executionApprovalInvalid();
  }
  if (profile.environmentKind === "PRODUCTION" && !authorization.productionConfirmed) {
    throw new AppError(
      "Production execution requires explicit confirmation for this approved run.",
      409,
      "QA_PRODUCTION_CONFIRMATION_REQUIRED"
    );
  }
  let currentProfile;
  try {
    currentProfile = selectProfile(job.runnerRegistration.publicProfiles, job.profileKey);
  } catch {
    throw executionProfileChanged();
  }
  if (currentProfile.manifestHash !== profile.manifestHash) throw executionProfileChanged();
  // The registration is mutable; it is only a compatibility check, never the
  // source of the task's approved environment or evidence requirements.
  return profile;
}

function executionApprovalInvalid() {
  return new AppError(
    "The execution no longer matches its immutable owner approval.",
    409,
    "QA_EXECUTION_APPROVAL_INVALID"
  );
}

function executionProfileChanged() {
  return new AppError(
    "The Runner profile changed after execution approval. Review and approve a new run.",
    409,
    "QA_PROFILE_MANIFEST_CHANGED"
  );
}

function isExecutionApprovalError(error: unknown): error is AppError {
  return error instanceof AppError && [
    "QA_EXECUTION_APPROVAL_INVALID",
    "QA_PROFILE_MANIFEST_CHANGED",
    "QA_PRODUCTION_CONFIRMATION_REQUIRED",
    "QA_TARGET_APPROVAL_CHANGED",
    "QA_TARGET_VERIFICATION_REQUIRED",
    "QA_TARGET_REVISION_INVALID",
    "QA_SAVED_LOGIN_UNAVAILABLE",
    "BROWSER_SAVED_LOGIN_NOT_ACTIVE",
  ].includes(error.code);
}

function selectProfile(rawProfiles: Prisma.JsonValue, profileKey: string) {
  const profiles = profileManifestSchema.array().parse(rawProfiles);
  const profile = profiles.find((candidate) => candidate.profileKey === profileKey);
  if (!profile) {
    throw new AppError("Runner profile was not found.", 404, "QA_RUNNER_PROFILE_NOT_FOUND");
  }
  return resolveProfileManifest(profile);
}

async function lockAndRequireLease(
  tx: Prisma.TransactionClient,
  input: {
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
  },
  clock: () => Date
) {
  let currentTime = clock();
  const candidate = await tx.qaExecutionJob.findFirst({
    select: { requestId: true },
    where: {
      claimId: input.lease.claimId,
      deadlineAt: { gt: currentTime },
      id: input.executionId,
      leaseExpiresAt: { gt: currentTime },
      leaseTokenHash: hashLeaseToken(input.lease.leaseToken),
      runnerRegistration: { connectionTokenId: input.connectionTokenId },
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
  if (!candidate) throw leaseLost();
  await lockRequest(tx, candidate.requestId);
  await requireManagedAdmission(tx,input.connectionTokenId,clock);
  currentTime = clock();
  const job = await tx.qaExecutionJob.findFirst({
    include: { run: true },
    where: {
      claimId: input.lease.claimId,
      deadlineAt: { gt: currentTime },
      id: input.executionId,
      leaseExpiresAt: { gt: currentTime },
      leaseTokenHash: hashLeaseToken(input.lease.leaseToken),
      runnerRegistration: { connectionTokenId: input.connectionTokenId },
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
  if (!job) throw leaseLost();
  return job;
}

async function reconcileUnclaimableJob(
  tx: Prisma.TransactionClient,
  runnerRegistrationId: string,
  currentTime: Date,
  actor: QaActor
) {
  const candidate = await tx.qaExecutionJob.findFirst({
    orderBy: [{ deadlineAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, requestId: true },
    where: {
      runnerRegistrationId,
      status: { in: ["QUEUED", ...ACTIVE_JOB_STATUSES] },
      OR: [
        { deadlineAt: { lte: currentTime } },
        { protocolVersion: 2, status: { in: [...ACTIVE_JOB_STATUSES] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: currentTime } }] },
        {
          attempts: { gte: MAX_JOB_ATTEMPTS },
          OR: [
            { status: "QUEUED" },
            {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: currentTime } },
              ],
              status: { in: [...ACTIVE_JOB_STATUSES] },
            },
          ],
        },
      ],
    },
  });
  if (!candidate) return false;
  await lockRequest(tx, candidate.requestId);
  const job = await tx.qaExecutionJob.findFirst({
    include: { run: true },
    where: { id: candidate.id, runnerRegistrationId },
  });
  if (!job) return false;
  const failure = unclaimableJobFailure(job, currentTime);
  if (!failure) return false;
  await terminalizeExecutionFailure(tx, job, actor, failure, currentTime);
  return true;
}

function unclaimableJobFailure(
  job: {
    attempts: number;
    deadlineAt: Date;
    leaseExpiresAt: Date | null;
    status: string;
    protocolVersion?: number;
  },
  currentTime: Date
) {
  if (!["QUEUED", ...ACTIVE_JOB_STATUSES].includes(job.status)) return null;
  if (job.deadlineAt.getTime() <= currentTime.getTime()) {
    return {
      code: "EXECUTION_DEADLINE_EXCEEDED",
      message: "The execution deadline elapsed before the runner could finish.",
    };
  }
  const hasNoLiveLease = job.status === "QUEUED"
    || job.leaseExpiresAt === null
    || job.leaseExpiresAt.getTime() <= currentTime.getTime();
  if (job.protocolVersion === 2 && job.status !== "QUEUED" && hasNoLiveLease) {
    return { code: "EXECUTION_INTERRUPTED", message: "The managed execution lease was lost. A new run and approval are required; steps are never replayed." };
  }
  if (job.attempts >= MAX_JOB_ATTEMPTS && hasNoLiveLease) {
    return {
      code: "EXECUTION_ATTEMPTS_EXHAUSTED",
      message: "The execution could not be completed within the allowed claim attempts.",
    };
  }
  return null;
}

async function terminalizeExecutionFailure(
  tx: Prisma.TransactionClient,
  job: { id: string; requestId: string; runId: string },
  actor: QaActor,
  failure: { code: string; message: string },
  failedAt: Date
) {
  await tx.qaExecutionJob.update({
    data: {
      completedAt: failedAt,
      errorCode: failure.code,
      errorMessage: failure.message,
      leaseExpiresAt: null,
      leaseTokenHash: null,
      status: "FAILED",
    },
    where: { id: job.id },
  });
  const run = await tx.qaRun.update({
    data: { status: "CANCELLED", version: { increment: 1 } },
    where: { id: job.runId },
  });
  await tx.qaRequest.update({
    data: { phase: "READY_TO_RUN", version: { increment: 1 } },
    where: { id: job.requestId },
  });
  await appendEvent(tx, job.requestId, actor, "EXECUTION_FAILED", {
    errorCode: failure.code,
    executionId: job.id,
    message: failure.message,
  });
  return run;
}

function earlierDate(first: Date, second: Date) {
  return first.getTime() <= second.getTime() ? first : second;
}

function executionReceipt(
  job: { id: string; runId: string; run: { version: number }; status: string },
  status: "CLAIMED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
  leaseExpiresAt: Date | null,
  runVersion = job.run.version,
  requestPhase: "RUNNING" | "READY_TO_RUN" | "EVIDENCE_NEEDED" | "READY_FOR_REVIEW" = "RUNNING"
) {
  return {
    executionId: job.id,
    leaseExpiresAt: leaseExpiresAt?.toISOString() || null,
    requestPhase,
    runId: job.runId,
    runVersion,
    status,
  };
}

async function countMissingEvidence(
  tx: Prisma.TransactionClient,
  runId: string,
  artifactId: string,
  currentTime: Date
) {
  const requirements = await tx.qaEvidenceRequirement.findMany({
    select: { id: true },
    where: { checklistItem: { artifactId }, required: true },
  });
  if (requirements.length === 0) return 0;
  const fulfilled = await tx.qaEvidence.findMany({
    select: { requirementId: true, kind: true, externalReference: true, assets: {select: {id: true}} },
    where: { requirementId: { in: requirements.map(({ id }) => id) }, runId, ...availableEvidenceWhere(currentTime) },
  });
  return requirements.length - new Set(fulfilled.filter(hasQaEvidenceContent).map(({requirementId}) => requirementId)).size;
}

function calculateOutcome(statuses: string[]) {
  if (statuses.includes("FAIL")) return "FAIL" as const;
  if (statuses.includes("BLOCKED")) return "BLOCKED" as const;
  if (statuses.includes("SKIPPED")) return "INCOMPLETE" as const;
  return "PASS" as const;
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
      metadata: metadata as Prisma.InputJsonValue | undefined,
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

export function hashLeaseToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestNotFound() {
  return new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
}

function recipeNotFound() {
  return new AppError("Execution Recipe was not found.", 404, "QA_EXECUTION_RECIPE_NOT_FOUND");
}

function runnerNotFound() {
  return new AppError("Runner registration was not found.", 404, "QA_RUNNER_NOT_FOUND");
}

function executionNotFound() {
  return new AppError("QA execution was not found.", 404, "QA_EXECUTION_NOT_FOUND");
}

function leaseLost() {
  return new AppError("The execution lease is no longer current.", 409, "QA_EXECUTION_LEASE_LOST");
}

function staleVersion() {
  return new AppError("The QA record changed. Refresh and retry.", 409, "QA_VERSION_CONFLICT");
}

function invalidPhase(phase: string) {
  return new AppError(`QA request cannot perform this action from ${phase}.`, 409, "QA_PHASE_INVALID");
}

function invalidRunStatus(status: string) {
  return new AppError(`QA run cannot perform this action from ${status}.`, 409, "QA_RUN_STATUS_INVALID");
}

function invalidExecutionStatus(status: string) {
  return new AppError(
    `QA execution cannot perform this action from ${status}.`,
    409,
    "QA_EXECUTION_STATUS_INVALID"
  );
}
