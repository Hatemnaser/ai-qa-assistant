import type { z } from "zod";
import { executionBindingV2Schema, profileManifestV2Schema, type runtimeRegistrationV2Schema, type runtimeExitV2Schema } from "@oddpath/qa-execution-contract";
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { hashCanonicalJson } from '../../lib/canonical-json.js';
import { requireApprovedTarget, requireCurrentTargetVerification } from '../qa-targets/qa-targets.execution.js';
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { cancelLockedExecution, hashLeaseToken } from "../qa-requests/qa-execution.repository.js";
import { lockQaSessionScope, lockTestProject } from "../test-sessions/test-sessions.guard.js";
import type { BrowserRuntimeRepository } from "./browser-runtime.types.js";
import { browserStateTransferSchema, parseBrowserStorageState, SAVED_LOGIN_MAX_MS } from '@oddpath/qa-execution-contract';
import { sealBrowserState, unsealBrowserState } from '@oddpath/qa-execution-contract/browser-state-crypto';
import { loadBrowserAuthVault, unavailable, type BrowserAuthVault } from '../browser-auth/browser-auth.vault.js';
import { requireSavedAuthentication, savedStateBinding } from '../browser-auth/browser-auth.authority.js';
import { requireBrowserReservation } from './browser-reservations.js';
import {requireManagedAdmission} from './managed-project-identity.js';

export function createBrowserRuntimeRepository(database: typeof prisma = prisma, now = () => new Date(), options: { allowManualLogin?: boolean; savedVault?: BrowserAuthVault; enforceBrowserQuota?:boolean } = {}): BrowserRuntimeRepository {
  async function lockedJob(tx: Prisma.TransactionClient, connectionId: string, executionId: string) {
    const candidate = await tx.qaExecutionJob.findFirst({ where: { id: executionId, protocolVersion: 2, runnerRegistration: { connectionTokenId: connectionId } } });
    if (!candidate) throw missing();
    await lockQaSessionScope(tx, candidate.requestId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${candidate.requestId}`},0))`;
    const job = await tx.qaExecutionJob.findFirst({ include: { browserRuntime: true, authorization: true, recipe: true, request: true }, where: { id: executionId, protocolVersion: 2, runnerRegistration: { connectionTokenId: connectionId } } });
    if (!job) throw missing();
    return job;
  }
  async function lockedOwner(tx: Prisma.TransactionClient, userId: string, projectId: string, executionId: string) {
    const where = { id: executionId, projectId, protocolVersion: 2, project: { ownerId: userId } };
    const candidate = await tx.qaExecutionJob.findFirst({ where }); if (!candidate) throw missing();
    await lockQaSessionScope(tx, candidate.requestId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${candidate.requestId}`},0))`;
    const job = await tx.qaExecutionJob.findFirst({ where, include: { browserRuntime: true, authorization: true, recipe: true, request: true } });
    if (!job) throw missing(); return job;
  }
  async function manualAuthority(tx: Prisma.TransactionClient, job: Awaited<ReturnType<typeof lockedJob>>, kind: 'MANUAL'|'SAVED_STATE'='MANUAL') {
    if(!job.runnerRegistrationId)throw invalidLogin();
    const registration=await tx.qaRunnerRegistration.findUnique({where:{id:job.runnerRegistrationId},select:{connectionTokenId:true}});
    if(!registration)throw invalidLogin();
    await requireManagedAdmission(tx,registration.connectionTokenId,now);
    if (kind==='MANUAL' ? !(options.allowManualLogin ?? env.qaManualLoginEnabled) : !(options.savedVault||env.qaSavedLoginEnabled)) throw invalidLogin();
    const profile = profileManifestV2Schema.parse(job.recipe.profileManifest), binding = executionBindingV2Schema.parse(job.authorization.binding);
    if (profile.authentication.kind !== kind || hashCanonicalJson(binding) !== job.authorization.bindingHash
      || profile.manifestHash !== job.profileManifestHash || profile.manifestHash !== binding.profileManifestHash
      || profile.target.targetHash !== binding.targetHash || profile.target.revisionId !== binding.targetRevisionId
      || job.recipeHash !== binding.recipeHash || job.request.version !== binding.requestVersion + 1
      || job.request.selectedArtifactId !== binding.artifactId) throw invalidLogin();
    if (job.request.testSessionId) {
      const session = await tx.testSession.findUnique({ where: { id: job.request.testSessionId } });
      if (!session || session.archivedAt || session.currentRequestId !== job.requestId) throw invalidLogin();
    }
    const verification = await requireApprovedTarget(tx, job.projectId, profile, now, binding.verificationId);
    // Reload under the row lock, then revalidate the exact proof using the time
    // after every possible lock wait before granting or acknowledging input.
    await tx.$executeRaw`SELECT 1 FROM "QaBrowserRuntime" WHERE "executionId"=${job.id} FOR UPDATE`;
    const runtime = await tx.qaBrowserRuntime.findUnique({where:{executionId:job.id}});
    if(kind==='SAVED_STATE')await requireSavedAuthentication(tx,job.projectId,profile,now,options.savedVault);
    const currentTime = now();
    requireCurrentTargetVerification(verification, currentTime);
    if (!runtime || runtime.state !== 'LIVE' || job.status !== 'CLAIMED' || job.acceptedAt
      || !job.leaseExpiresAt || job.leaseExpiresAt <= currentTime || job.deadlineAt <= currentTime
      || new Date(binding.expiresAt) <= currentTime || !runtime.loginDeadlineAt || runtime.loginDeadlineAt <= currentTime) throw invalidLogin();
    return { profile, runtime, currentTime };
  }
  async function read(connectionId: string, executionId: string, stop = false) {
    return database.$transaction(async tx => {
      const job = await lockedJob(tx, connectionId, executionId), currentTime = now();
      const runtime = job.browserRuntime;
      if (!runtime) throw missing();
      const expired = job.deadlineAt <= currentTime || !job.leaseExpiresAt || job.leaseExpiresAt <= currentTime || !['CLAIMED','RUNNING'].includes(job.status)
        || (!['NONE','READY'].includes(runtime.loginPhase) && (!runtime.loginDeadlineAt || runtime.loginDeadlineAt <= currentTime));
      if (runtime.state === 'LIVE' && (stop || expired)) {
        return tx.qaBrowserRuntime.update({ where: { runtimeId: runtime.runtimeId }, data: { state: 'STOP_REQUESTED', stopRequestedAt: currentTime } });
      }
      if (!expired && runtime.state === 'LIVE') await tx.qaBrowserRuntime.update({ where: { runtimeId: runtime.runtimeId }, data: { lastSeenAt: currentTime } });
      if (!expired && runtime.state === 'LIVE') {
        const profile=profileManifestV2Schema.parse(job.recipe.profileManifest);
        try {
          if(profile.authentication.kind==='SAVED_STATE')await requireSavedAuthentication(tx,job.projectId,profile,now,options.savedVault);
          else if(!['NONE','READY'].includes(runtime.loginPhase))await manualAuthority(tx,job);
        }catch(error){
          if(profile.authentication.kind!=='SAVED_STATE')throw error;
          return tx.qaBrowserRuntime.update({where:{runtimeId:runtime.runtimeId},data:{state:'STOP_REQUESTED',stopRequestedAt:now()}});
        }
      }
      return runtime;
    });
  }
  return {
    async begin(connectionId, executionId, lease, input: z.infer<typeof runtimeRegistrationV2Schema>) {
      return database.$transaction(async tx => {
        const job = await lockedJob(tx, connectionId, executionId), currentTime = now();
        await requireManagedAdmission(tx,connectionId,now);
        if (job.status !== 'CLAIMED' || job.acceptedAt || job.claimId !== lease.claimId
          || job.leaseTokenHash !== hashLeaseToken(lease.leaseToken) || !job.leaseExpiresAt
          || job.leaseExpiresAt <= currentTime || job.deadlineAt <= currentTime) throw invalid();
        if (job.browserRuntime) {
          if (job.browserRuntime.runtimeId !== input.runtimeId || job.browserRuntime.claimId !== lease.claimId || job.browserRuntime.imageDigest !== input.imageDigest || job.browserRuntime.state !== 'LIVE') throw invalid();
          return job.browserRuntime;
        }
        const binding = executionBindingV2Schema.parse(job.authorization.binding);
        const manual = binding.authentication.kind === 'MANUAL';
        const saved = binding.authentication.kind === 'SAVED_STATE';
        if(saved)await requireSavedAuthentication(tx,job.projectId,profileManifestV2Schema.parse(job.recipe.profileManifest),now,options.savedVault);
        if (manual && !(options.allowManualLogin ?? env.qaManualLoginEnabled)) throw invalidLogin();
        const loginDeadlineAt = input.preparationDeadlineAt ? new Date(input.preparationDeadlineAt) : null;
        if(options.enforceBrowserQuota!==false)await requireBrowserReservation(tx,executionId);
        const decisionAt=now();
        if(job.leaseExpiresAt<=decisionAt||job.deadlineAt<=decisionAt)throw invalid();
        if (manual||saved ? !loginDeadlineAt || loginDeadlineAt <= decisionAt || loginDeadlineAt > job.deadlineAt
          || loginDeadlineAt.getTime() > decisionAt.getTime() + binding.executionLimits.preparationTimeoutMs : loginDeadlineAt !== null) throw invalidLogin();
        return tx.qaBrowserRuntime.create({ data: { runtimeId: input.runtimeId, imageDigest: input.imageDigest, executionId, claimId: lease.claimId, startedAt: currentTime, lastSeenAt: currentTime,authenticationKind:binding.authentication.kind,
          ...(manual||saved ? { loginPhase: 'WAITING', loginEpoch: randomUUID(), loginDeadlineAt } : {}) } });
      });
    },
    async loginOwned(userId, projectId, executionId, epoch, action) {
      return database.$transaction(async tx => {
        const job = await lockedOwner(tx, userId, projectId, executionId), { runtime, currentTime } = await manualAuthority(tx, job);
        if (runtime.loginEpoch !== epoch) throw invalidLogin();
        if (action === 'CHECK') { if (runtime.loginPhase !== 'LOGIN') throw invalidLogin(); return runtime; }
        const [expected, next] = action === 'BEGIN' ? ['WAITING','ENTER_REQUESTED'] : ['LOGIN','FINISH_REQUESTED'];
        if (runtime.loginPhase === next) return runtime;
        if (runtime.loginPhase !== expected) throw invalidLogin();
        return tx.qaBrowserRuntime.update({ where: { runtimeId: runtime.runtimeId }, data: { loginPhase: next, lastSeenAt: currentTime } });
      });
    },
    async loginAck(connectionId, executionId, lease, input) {
      return database.$transaction(async tx => {
        const job = await lockedJob(tx, connectionId, executionId);
        const kind=profileManifestV2Schema.parse(job.recipe.profileManifest).authentication.kind;
        const { runtime, currentTime } = await manualAuthority(tx, job,kind==='SAVED_STATE'?'SAVED_STATE':'MANUAL');
        if (job.claimId !== lease.claimId || job.leaseTokenHash !== hashLeaseToken(lease.leaseToken)
          || runtime.runtimeId !== input.runtimeId || runtime.loginEpoch !== input.controlEpoch) throw invalidLogin();
        if (runtime.loginPhase === input.phase) return runtime;
        if (kind==='SAVED_STATE' ? runtime.loginPhase!=='WAITING'||input.phase!=='READY' : runtime.loginPhase !== (input.phase === 'LOGIN' ? 'ENTER_REQUESTED' : 'FINISH_REQUESTED')) throw invalidLogin();
        return tx.qaBrowserRuntime.update({ where: { runtimeId: runtime.runtimeId }, data: { loginPhase: input.phase, lastSeenAt: currentTime } });
      });
    },
    async saveConsentOwned(userId,projectId,executionId,epoch,saveLogin){
      return database.$transaction(async tx=>{
        const job=await lockedOwner(tx,userId,projectId,executionId),{runtime,currentTime}=await manualAuthority(tx,job);
        if(!(options.savedVault||env.qaSavedLoginEnabled)||runtime.loginEpoch!==epoch||runtime.loginPhase!=='LOGIN'||runtime.savedLoginId)throw invalidLogin();
        return tx.qaBrowserRuntime.update({where:{runtimeId:runtime.runtimeId},data:{saveLoginConsentAt:saveLogin?(runtime.saveLoginConsentAt??currentTime):null}});
      });
    },
    async captureState(connectionId,executionId,lease,raw){
      return database.$transaction(async tx=>{
        const job=await lockedJob(tx,connectionId,executionId),{profile,runtime,currentTime}=await manualAuthority(tx,job);
        if(!runtime.saveLoginConsentAt||!['FINISH_REQUESTED','READY'].includes(runtime.loginPhase)||job.claimId!==lease.claimId||job.leaseTokenHash!==hashLeaseToken(lease.leaseToken))throw invalidLogin();
        const transfer=browserStateTransferSchema.parse(raw),c=transfer.context;
        if(c.purpose!=='CAPTURE'||c.executionId!==executionId||c.runtimeId!==runtime.runtimeId||c.claimId!==job.claimId||c.bindingHash!==job.authorization.bindingHash||c.controlEpoch!==runtime.loginEpoch
          ||c.expiresAt<=currentTime.getTime()||c.expiresAt>Math.min(job.leaseExpiresAt!.getTime(),runtime.loginDeadlineAt!.getTime(),currentTime.getTime()+15000))throw unavailable();
        const vault=options.savedVault??loadBrowserAuthVault();
        const state=parseBrowserStorageState(unsealBrowserState(transfer.packet,c,vault.transfer),[new URL(profile.target.baseUrl).origin,...profile.target.authenticationOrigins]);
        if(runtime.savedLoginId)return {savedLoginId:runtime.savedLoginId};
        const owner=await tx.project.findUniqueOrThrow({where:{id:job.projectId},select:{ownerId:true}});
        if(await tx.qaSavedBrowserState.count({where:{ownerId:owner.ownerId,revokedAt:null,expiresAt:{gt:now()}}})>=20)throw unavailable();
        const createdAt=runtime.saveLoginConsentAt,record={id:randomUUID(),ownerId:owner.ownerId,projectId:job.projectId,targetRevisionId:profile.target.revisionId,targetHash:profile.target.targetHash,revision:1,createdAt,expiresAt:new Date(createdAt.getTime()+SAVED_LOGIN_MAX_MS)};
        // Recheck after all asynchronous reads, then durably issue the external
        // identity before publishing its encrypted PostgreSQL record.
        await manualAuthority(tx,job);
        vault.revocations.issue(savedStateBinding(record));
        if(!vault.revocations.allows(savedStateBinding(record),()=>now().getTime()))throw unavailable();
        const finalAuthority=await manualAuthority(tx,job);
        if(c.expiresAt<=finalAuthority.currentTime.getTime())throw unavailable();
        await tx.qaSavedBrowserState.create({data:{...record,sourceRuntimeId:runtime.runtimeId,sealedState:sealBrowserState(state,savedStateBinding(record),vault.storage)}});
        await tx.qaBrowserRuntime.update({where:{runtimeId:runtime.runtimeId},data:{savedLoginId:record.id}});
        return {savedLoginId:record.id};
      });
    },
    async restoreState(connectionId,executionId,lease){
      return database.$transaction(async tx=>{
        const job=await lockedJob(tx,connectionId,executionId),{profile,runtime}=await manualAuthority(tx,job,'SAVED_STATE');
        if(job.claimId!==lease.claimId||job.leaseTokenHash!==hashLeaseToken(lease.leaseToken)||runtime.loginPhase!=='WAITING')throw invalidLogin();
        const vault=options.savedVault??loadBrowserAuthVault(),row=await requireSavedAuthentication(tx,job.projectId,profile,now,vault);
        if(!row)throw unavailable();
        const state=parseBrowserStorageState(unsealBrowserState(row.sealedState,savedStateBinding(row),vault.storage),[new URL(profile.target.baseUrl).origin,...profile.target.authenticationOrigins]);
        const authority=await manualAuthority(tx,job,'SAVED_STATE');
        const context={purpose:'RESTORE' as const,executionId,runtimeId:runtime.runtimeId,claimId:lease.claimId,bindingHash:job.authorization.bindingHash!,controlEpoch:runtime.loginEpoch!,expiresAt:Math.min(authority.currentTime.getTime()+15000,job.leaseExpiresAt!.getTime(),runtime.loginDeadlineAt!.getTime())};
        return {context,packet:sealBrowserState(state,context,vault.transfer)};
      });
    },
    async requestOwnerStop(userId, projectId) {
      // Cancel under the same lifecycle/request locks as claim/begin/accept.
      // A job without a runtime row must not register after logout completes.
      const projects = await database.project.findMany({ where: { ownerId: userId, ...(projectId ? { id: projectId } : {}) }, select: { id: true }, orderBy: { id: 'asc' } });
      let confirmed = true;
      for (const project of projects) {
        const stopped = await database.$transaction(async tx => {
          await lockTestProject(tx, project.id);
          const jobs = await tx.qaExecutionJob.findMany({ where: { projectId: project.id, protocolVersion: 2, status: { in: ['QUEUED','CLAIMED','RUNNING'] } }, select: { id: true }, orderBy: { requestId: 'asc' } });
          for (const candidate of jobs) {
            const job = await lockedOwner(tx, userId, project.id, candidate.id);
            await cancelLockedExecution(tx, job, { kind: 'USER', transport: 'WEB', userId }, now());
          }
          // Retain the runtime record until actual exit, including allocations
          // registered before Docker starts and terminal jobs awaiting cleanup.
          const where = { execution: { projectId: project.id, project: { ownerId: userId } }, state: { not: 'STOP_CONFIRMED' } };
          await tx.qaBrowserRuntime.updateMany({ where: { ...where, state: 'LIVE' }, data: { state: 'STOP_REQUESTED', stopRequestedAt: now() } });
          return await tx.qaBrowserRuntime.count({ where }) === 0;
        });
        confirmed = stopped && confirmed;
      }
      return confirmed;
    },
    status: (connectionId, executionId) => read(connectionId, executionId),
    requestStop: (connectionId, executionId) => read(connectionId, executionId, true),
    async exit(connectionId, executionId, input: z.infer<typeof runtimeExitV2Schema>) {
      return database.$transaction(async tx => {
        const job = await lockedJob(tx, connectionId, executionId), runtime = job.browserRuntime, currentTime = now();
        const observedAt = new Date(input.observedAt);
        if (!runtime || input.runtimeId !== runtime.runtimeId || !runtime.stopRequestedAt
          || observedAt < runtime.stopRequestedAt || observedAt > currentTime) throw invalid();
        if (runtime.state === 'STOP_CONFIRMED') return runtime;
        return tx.qaBrowserRuntime.update({ where: { runtimeId: runtime.runtimeId }, data: { state: 'STOP_CONFIRMED', exitObservedAt: observedAt, lastSeenAt: currentTime } });
      });
    },
    async owned(userId, projectId, executionId) {
      const runtime = await database.qaBrowserRuntime.findFirst({
        where: { executionId, execution: { projectId, project: { ownerId: userId } } },
        include: { execution: { select: { id: true, deadlineAt: true, leaseExpiresAt: true, status: true, authorization: { select: { bindingHash: true } } } } },
      });
      if (!runtime) throw missing();
      return runtime;
    },
    async reap() {
      const scanTime = now();
      const candidates = await database.qaBrowserRuntime.findMany({
        where: { state: 'LIVE', OR: [ { execution: { OR: [{ status: { in: ['SUCCEEDED','FAILED','CANCELLED'] } }, { deadlineAt: { lte: scanTime } }, { leaseExpiresAt: { lte: scanTime } }, { leaseExpiresAt: null }] } },
          { loginPhase: { notIn: ['NONE','READY'] }, loginDeadlineAt: { lte: scanTime } } ] },
        take: 20, orderBy: { lastSeenAt: 'asc' }, include: { execution: { select: { requestId: true } } },
      });
      let expired = 0;
      for (const candidate of candidates) expired += await database.$transaction(async tx => {
        await lockQaSessionScope(tx, candidate.execution.requestId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${candidate.execution.requestId}`},0))`;
        const job = await tx.qaExecutionJob.findUnique({ where: { id: candidate.executionId }, include: { browserRuntime: true } }), currentTime = now();
        if (!job?.browserRuntime || job.browserRuntime.state !== 'LIVE' || (['CLAIMED','RUNNING'].includes(job.status) && job.deadlineAt > currentTime && job.leaseExpiresAt && job.leaseExpiresAt > currentTime
          && (['NONE','READY'].includes(job.browserRuntime.loginPhase) || (job.browserRuntime.loginDeadlineAt && job.browserRuntime.loginDeadlineAt > currentTime)))) return 0;
        await tx.qaBrowserRuntime.update({ where: { runtimeId: candidate.runtimeId }, data: { state: 'STOP_REQUESTED', stopRequestedAt: currentTime } });
        return 1;
      });
      const currentTime = now();
      await database.qaBrowserRuntime.updateMany({ where: { state: 'STOP_REQUESTED', stopRequestedAt: { lte: new Date(currentTime.getTime() - 15_000) } }, data: { state: 'STOP_UNCONFIRMED' } });
      return expired;
    },
  };
}
export const browserRuntimeRepository = createBrowserRuntimeRepository();
export async function requestOwnerBrowserStop(userId:string,projectId?:string){
  const rows=await prisma.$queryRaw<Array<{exists:boolean}>>`SELECT to_regclass('public."QaBrowserRuntime"') IS NOT NULL AS "exists"`;
  return rows[0]?.exists?browserRuntimeRepository.requestOwnerStop(userId,projectId):true;
}
function missing() { return new AppError('Browser runtime was not found.', 404, 'BROWSER_RUNTIME_NOT_FOUND'); }
function invalid() { return new AppError('Runtime does not match the live execution lease or termination request.', 409, 'BROWSER_RUNTIME_INVALID'); }
function invalidLogin() { return new AppError('Human preparation authority is unavailable or changed.', 409, 'BROWSER_LOGIN_UNAVAILABLE'); }
