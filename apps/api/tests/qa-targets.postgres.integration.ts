import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { sealBrowserState,unsealBrowserState } from '@oddpath/qa-execution-contract/browser-state-crypto';
import { BrowserStateRevocations } from '../src/modules/browser-auth/browser-auth.vault.js';
import { createBrowserAuthRepository } from '../src/modules/browser-auth/browser-auth.repository.js';
import { lockBrowserDeletion,revokeDeletedBrowserScope } from '../src/modules/browser-auth/browser-auth.deletion.js';
import { savedStateBinding } from '../src/modules/browser-auth/browser-auth.authority.js';
import { executionTaskV2Schema, profileManifestV2Schema, recipeBundleV1Schema, targetDefinitionSchema, type ProfileManifestV2 } from "@oddpath/qa-execution-contract";
import { assertPostgresIntegrationTarget } from "./helpers/postgresIntegrationTarget.ts";

// Never imported by test:api: require an explicit disposable DB before client load.
const databaseTarget = assertPostgresIntegrationTarget(process.env);
const { prisma } = await import("../src/db/prisma.ts");
const { hashCanonicalJson } = await import("../src/lib/canonical-json.ts");
const { createQaTargetsRepository } = await import("../src/modules/qa-targets/qa-targets.repository.ts");
const { createQaTargetsService } = await import("../src/modules/qa-targets/qa-targets.service.ts");
const { challengeHash } = await import("../src/modules/qa-targets/qa-targets.proof.ts");
const { createProjectAccessService } = await import("../src/modules/projects/project-access.service.ts");
const { createQaExecutionRepository: createQuotaExecutionRepository, reapV2Executions, invalidateQueuedLegacyExecutions } = await import("../src/modules/qa-requests/qa-execution.repository.ts");
const { createBrowserRuntimeRepository: createQuotaRuntimeRepository } = await import("../src/modules/browser-runtime/browser-runtime.repository.ts");
const { resolveProfileManifest } = await import("../src/modules/qa-requests/qa-execution-recipes.repository.ts");
const prefix = `target-dbit-${randomUUID()}`;
const ownerId = `${prefix}-owner`, otherId = `${prefix}-other`, projectId = `${prefix}-project`, otherProjectId = `${prefix}-other-project`;
// These pre-06B tests isolate target/login/Stop authority and intentionally
// create many overlapping allocations. Capacity is exercised with real defaults
// in quota-reservations.postgres.integration.ts.
const createQaExecutionRepository=(...args:Parameters<typeof createQuotaExecutionRepository>)=>createQuotaExecutionRepository(args[0],args[1],{...args[2],enforceBrowserQuota:false});
const createBrowserRuntimeRepository=(...args:Parameters<typeof createQuotaRuntimeRepository>)=>createQuotaRuntimeRepository(args[0],args[1],{...args[2],enforceBrowserQuota:false});
const NOW = new Date();
const actor = { kind: "USER" as const, transport: "WEB" as const, userId: ownerId };
const targets = createQaTargetsRepository(prisma, () => NOW);
const executor = createQaExecutionRepository(prisma, () => NOW, { allowV2: true });
const access = createProjectAccessService({ findProjectOwner: (id: string) => prisma.project.findUnique({ where: { id }, select: { ownerId: true } }) });
const manualProjectId = `${prefix}-manual-project`;
let sequence = 0;

async function newTarget(environmentKind: "STAGING" | "PRODUCTION" = "STAGING", scopeProjectId=projectId) {
  const definition = targetDefinitionSchema.parse({ baseUrl: "https://staging.example.com/app", environmentKind, candidate: { reference: "build-123", source: "DECLARED" }, authenticationOrigins: ["https://login.example.com"], resourceOrigins: ["https://cdn.example.com"] });
  return targets.create({ userId: ownerId, projectId:scopeProjectId, label: "Staging", definition });
}
async function newFixture(environmentKind: "STAGING" | "PRODUCTION" = "STAGING", authenticate: boolean | 'MANUAL' = false, mutation = false, scopeProjectId=projectId) {
  const key = `${prefix}-${++sequence}`, target = await newTarget(environmentKind,scopeProjectId);
  const proof = await targets.challenge({ projectId:scopeProjectId, targetId: target.targetId, expectedRevision: 1, method: "DNS_TXT", challengeHash: challengeHash("integration-owned-domain-proof"), expiresAt: new Date(NOW.getTime() + 600_000) });
  await targets.confirm({ projectId:scopeProjectId, targetId: target.targetId, revisionId: target.revisionId, verificationId: proof.id, verifiedAt: NOW, validUntil: new Date(NOW.getTime() + 86_400_000) });
  const profile = resolveProfileManifest(profileManifestV2Schema.parse({ schemaVersion: 2, profileKey: "staging", label: "Staging", environmentKind, target, authentication: authenticate === 'MANUAL' ? { kind: 'MANUAL' } : authenticate ? { kind: "SAVED_STATE", id: "saved-login", revision: 1, targetRevisionId: target.revisionId } : { kind: "NONE" }, executionLimits: { preparationTimeoutMs: 300_000, executionTimeoutMs: 600_000 }, executorKey: "playwright", evidenceKinds: ["TEXT"], recipeSchemaVersions: [1], valueReferences: [] }));
  const request = await prisma.qaRequest.create({ data: { id: `${key}-request`, projectId:scopeProjectId, title: "Home", objective: "Verify heading", phase: "READY_TO_RUN" } });
  const snapshot = await prisma.qaContextSnapshot.create({ data: { requestId: request.id, version: 1, payload: {}, sourceManifest: {}, payloadHash: "test", retrievalMode: "NONE" } });
  const artifact = await prisma.qaArtifact.create({ data: { requestId: request.id, snapshotId: snapshot.id, revision: 1, origin: "AGENT_PROVIDED", title: "Home checklist", canonicalJson: {} } });
  const item = await prisma.qaChecklistItem.create({ data: { artifactId: artifact.id, ordinal: 0, title: "Home", expectedResult: "Heading is visible", evidenceRequirements: { create: { ordinal: 0, description: "Record the heading", kind: "TEXT", required: true } } } });
  const bundle = recipeBundleV1Schema.parse({ schemaVersion: 1, engine: "playwright", items: [{ checklistItemId: item.id, steps: [
    { action: "navigate", path: "/", ref: "open", waitUntil: "domcontentloaded" },
    ...(mutation ? [{ action: "click", ref: "submit", locator: { by: "role", role: "button", name: "Save" } }] : []),
    { action: "expect", ref: "see", expectation: { kind: "visible", locator: { by: "role", role: "heading", name: "Home" } } },
  ] }] });
  const recipe = await prisma.qaExecutionRecipe.create({ data: { requestId: request.id, artifactId: artifact.id, revision: 1, origin: "AGENT_PROVIDED", executorKey: "playwright", title: "Home recipe", canonicalJson: bundle, recipeHash: hashCanonicalJson(bundle), profileManifest: profile, profileManifestHash: profile.manifestHash, transport: "WEB", assessments: { create: { status: "PASSED", suggestions: [] } } } });
  await prisma.qaRequest.update({ where: { id: request.id }, data: { selectedArtifactId: artifact.id } });
  const connection = await prisma.projectConnectionToken.create({ data: { projectId:scopeProjectId, ownerId, name: "Disposable runner", tokenPrefix: key, tokenHash: hashCanonicalJson(key), scopes: ["qa:read", "execution:claim", "execution:write"] } });
  const runner = await prisma.qaRunnerRegistration.create({ data: { projectId:scopeProjectId, connectionTokenId: connection.id, instanceId: key, displayName: "Fixture runner", runnerVersion: "0.2-test", protocolVersions: [2], executorKeys: ["playwright"], publicProfiles: [profile], lastSeenAt: NOW } });
  const startInput = { actor, projectId:scopeProjectId, requestId: request.id, expectedRequestVersion: request.version, profileKey: profile.profileKey, recipeId: recipe.id, recipeHash: recipe.recipeHash, runnerRegistrationId: runner.id, confirmProduction: environmentKind === "PRODUCTION" };
  const claimInput = { actor: { kind: "INTEGRATION" as const, transport: "REST" as const, userId: ownerId, connectionTokenId: connection.id }, connectionTokenId: connection.id, protocolVersion: 2 as const, request: { instanceId: runner.instanceId, registrationId: runner.id }, leaseToken: "t".repeat(43), leaseExpiresAt: new Date(NOW.getTime() + 45_000) };
  return { target, proof, profile, request, artifact, item, recipe, runner, connection, startInput, claimInput };
}
async function approve() {
  const f = await newFixture(), job = await executor.start(f.startInput);
  // This suite freezes the injected clock; DB default now() is a few ms later.
  await prisma.qaExecutionJob.update({ where: { id: job.executionId }, data: { availableAt: NOW } });
  return { ...f, job };
}
async function manualFixture(preparationMs=300_000,clock:()=>Date=()=>NOW){
  const f=await newFixture('STAGING','MANUAL',false,manualProjectId),exec=createQaExecutionRepository(prisma,clock,{allowV2:true,allowManualLogin:true});
  const job=await exec.start(f.startInput);await prisma.qaExecutionJob.update({where:{id:job.executionId},data:{availableAt:NOW}});
  const claimed=await exec.claim(f.claimInput) as {claim:{claimId:string;leaseToken:string}};
  const runtime=createBrowserRuntimeRepository(prisma,clock,{allowManualLogin:true}),runtimeId=randomUUID();
  await runtime.begin(f.connection.id,job.executionId,claimed.claim,{runtimeId,imageDigest:`sha256:${'a'.repeat(64)}`,preparationDeadlineAt:new Date(NOW.getTime()+preparationMs).toISOString()});
  const epoch=(await runtime.owned(ownerId,manualProjectId,job.executionId)).loginEpoch!;
  return {...f,job,exec,claimed,runtime,runtimeId,epoch};
}
async function assertFailed(executionId: string, code: string) {
  const job = await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: executionId }, include: { run: true, request: true } });
  assert.equal(job.status, "FAILED"); assert.equal(job.errorCode, code);
  assert.equal(job.leaseTokenHash, null); assert.equal(job.leaseExpiresAt, null);
  assert.equal(job.run.status, "CANCELLED"); assert.equal(job.request.phase, "READY_TO_RUN");
}

async function whileTargetLocked<T>(targetId: string, action: () => Promise<T>, advanceClock: () => void | Promise<void>, lockPrefix = 'qa-target'): Promise<PromiseSettledResult<T>> {
  const pool = new Pool({ connectionString: databaseTarget.connectionString }), holder = await pool.connect();
  let pending: Promise<PromiseSettledResult<T>> | undefined;
  try {
    await holder.query("BEGIN");
    const { rows: [{ pid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`oddpath:${lockPrefix}:${targetId}`]);
    pending = action().then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason }));
    // Observe a real blocked advisory lock before advancing the injected clock.
    // Timing the sleep alone would not establish that the application reached it.
    const waitUntil = Date.now() + 3_000;
    let blocked = false;
    while (!blocked && Date.now() < waitUntil) {
      const result = await pool.query<{ blocked: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM pg_locks waiter JOIN pg_locks holder
          ON waiter.locktype = holder.locktype AND waiter.database = holder.database
          AND waiter.classid = holder.classid AND waiter.objid = holder.objid AND waiter.objsubid = holder.objsubid
        WHERE holder.pid = $1 AND holder.locktype = 'advisory' AND holder.granted AND NOT waiter.granted
      ) AS blocked`, [pid]);
      blocked = result.rows[0].blocked;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "Execution must actually be waiting for this target lock.");
    await advanceClock();
    await holder.query("ROLLBACK");
    return await pending;
  } finally {
    await holder.query("ROLLBACK");
    if (pending) await pending;
    holder.release(); await pool.end();
  }
}

async function whileRuntimeLocked<T>(executionId: string, action: () => Promise<T>, advanceClock: () => void): Promise<PromiseSettledResult<T>> {
  const pool = new Pool({ connectionString: databaseTarget.connectionString }), holder = await pool.connect();
  let pending: Promise<PromiseSettledResult<T>> | undefined;
  try {
    await holder.query('BEGIN');
    const { rows: [{ pid }] } = await holder.query<{pid:number}>('SELECT pg_backend_pid() AS pid');
    await holder.query('SELECT 1 FROM "QaBrowserRuntime" WHERE "executionId"=$1 FOR UPDATE',[executionId]);
    pending = action().then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason}));
    let blocked = false; const deadline = Date.now()+3000;
    while(!blocked && Date.now()<deadline) {
      blocked = (await pool.query<{blocked:boolean}>('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0].blocked;
      if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(blocked,true,'Human authority must actually wait for the runtime row lock.');
    advanceClock(); await holder.query('ROLLBACK'); return await pending;
  } finally {
    await holder.query('ROLLBACK'); if(pending)await pending; holder.release(); await pool.end();
  }
}

describe("Immutable targets and approvals on real PostgreSQL", { concurrency: false }, () => {
  before(async () => {
    assert.equal((await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name, databaseTarget.databaseName);
    await prisma.user.createMany({ data: [{ id: ownerId, email: `${ownerId}@example.test` }, { id: otherId, email: `${otherId}@example.test` }] });
    await prisma.project.createMany({ data: [{ id: projectId, ownerId, name: "Targets integration" }, { id: otherProjectId, ownerId: otherId, name: "Other owner" }, {id:manualProjectId,ownerId,name:"Manual preparation integration"}] });
  });
  after(async () => {
    await prisma.qaRequest.deleteMany({ where: { projectId: { in: [projectId, otherProjectId, manualProjectId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId, manualProjectId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });
  it('drains active attempts before retiring queued legacy approvals and preserves authorization history', async () => {
    const queued = await approve();
    await prisma.qaExecutionJob.update({ where: { id: queued.job.executionId }, data: { protocolVersion: 1 } });
    await prisma.qaExecutionAuthorization.update({ where: { runId: queued.job.runId }, data: { protocolVersion: 1, requestVersion: null, targetRevisionId: null, targetHash: null, verificationId: null, bindingHash: null, binding: (await import('../src/generated/prisma/client.js')).Prisma.DbNull, expiresAt: null } });
    const authorization = await prisma.qaExecutionAuthorization.findUniqueOrThrow({ where: { runId: queued.job.runId } });
    const managed = createQaExecutionRepository(prisma, () => NOW, { allowV2: true, requireRuntime: true });
    const next = await newFixture();
    await assert.rejects(managed.start(next.startInput), { code: 'QA_LEGACY_DRAIN_REQUIRED' });
    const disabledLegacy = createQaExecutionRepository(prisma, () => NOW, { allowLegacyDispatch: false });
    assert.equal(await disabledLegacy.claim({ ...queued.claimInput, protocolVersion: 1 }), null);
    const active = await approve(); await executor.claim(active.claimInput);
    await assert.rejects(invalidateQueuedLegacyExecutions(prisma, () => NOW), { code: 'QA_LEGACY_DRAIN_REQUIRED' });
    await executor.cancel({ actor, projectId, requestId: active.request.id, runId: active.job.runId });
    assert.equal(await invalidateQueuedLegacyExecutions(prisma, () => NOW), 1);
    await assertFailed(queued.job.executionId, 'LEGACY_APPROVAL_RENEWAL_REQUIRED');
    assert.deepEqual(await prisma.qaExecutionAuthorization.findUniqueOrThrow({ where: { runId: queued.job.runId } }), authorization);
    assert.equal(await invalidateQueuedLegacyExecutions(prisma, () => NOW), 0);
    await managed.start(next.startInput);
  });
  it('records executor step observations only when they match the approved recipe and target',async()=>{
    const f=await approve(),claim=await executor.claim(f.claimInput) as {claim:{claimId:string;leaseToken:string}};
    const accepted=await executor.accept({actor:f.claimInput.actor,connectionTokenId:f.connection.id,executionId:f.job.executionId,lease:claim.claim}) as {runVersion:number};
    const bundle=recipeBundleV1Schema.parse(f.recipe.canonicalJson);
    await prisma.qaExecutionRecipeItem.create({data:{recipeId:f.recipe.id,checklistItemId:f.item.id,ordinal:0,steps:JSON.parse(JSON.stringify(bundle.items[0]!.steps)),recipeHash:f.recipe.recipeHash}});
    const input={actor:f.claimInput.actor,connectionTokenId:f.connection.id,executionId:f.job.executionId,lease:claim.claim,checklistItemId:f.item.id,
      submission:{status:'PASS' as const,observedResult:'Home heading visible',expectedRunVersion:accepted.runVersion,evidence:[{kind:'TEXT' as const,requirementId:null,textContent:'Home heading visible'}],
        observation:{startedAt:NOW.toISOString(),finishedAt:NOW.toISOString(),completedStepRefs:['open','wrong'],failedStepRef:null}}};
    await assert.rejects(()=>executor.recordItem(input),{code:'QA_OBSERVATION_INVALID'});assert.equal(await prisma.qaCheckResult.count({where:{runId:f.job.runId}}),0);
    input.submission.observation.completedStepRefs=['open','see'];await executor.recordItem(input);
    const result=await prisma.qaCheckResult.findFirstOrThrow({where:{runId:f.job.runId}}),provenance=result.provenance as {observation:{completedStepRefs:string[]};target:{definitionHash:string};build:{reference:string};executor:{registrationId:string}};
    assert.deepEqual(provenance.observation.completedStepRefs,['open','see']);assert.equal(provenance.target.definitionHash,f.target.targetHash);assert.equal(provenance.build.reference,'build-123');assert.equal(provenance.executor.registrationId,f.runner.id);
  });
  it("serializes competing revisions without editing the original snapshot", async () => {
    const target = await newTarget();
    const original = await prisma.qaTargetRevision.findUniqueOrThrow({ where: { id: target.revisionId } });
    const input = { userId: ownerId, projectId, targetId: target.targetId, expectedRevision: 1, label: "New deployment", definition: { ...targetDefinitionSchema.parse(original.definition), baseUrl: "https://next.example.com" } };
    const results = await Promise.allSettled([targets.revise(input), targets.revise(input)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "QA_TARGET_VERSION_CONFLICT").length, 1);
    assert.deepEqual(await prisma.qaTargetRevision.findUniqueOrThrow({ where: { id: target.revisionId } }), original);
    assert.equal(await prisma.qaTargetRevision.count({ where: { targetId: target.targetId } }), 2);
  });
  it("isolates project/owner authority and stores challenge hashes only", async () => {
    const target = await newTarget();
    const service = createQaTargetsService({ repository: targets, access, now: () => NOW, probe: { dns: async () => [], https: async () => "" } });
    await assert.rejects(service.list(otherId, projectId), { code: "PROJECT_NOT_FOUND" });
    assert.equal(await targets.getRevision(otherProjectId, target.targetId), null);
    const challenge = await service.challenge(ownerId, projectId, target.targetId, { expectedRevision: 1, method: "DNS_TXT" });
    const saved = await prisma.qaTargetVerification.findUniqueOrThrow({ where: { id: challenge.id } });
    assert.equal(saved.challengeHash, challengeHash(challenge.value));
    assert.equal(JSON.stringify(saved).includes(challenge.value), false);
    assert.equal(await targets.getVerification(otherProjectId, target.targetId, saved.id), null);
    await assert.rejects(service.challenge(ownerId, projectId, target.targetId, { expectedRevision: 1, method: "DNS_TXT" }), { code: "QA_TARGET_VERIFICATION_RATE_LIMITED" });
  });
  it("fences a target revision change while its domain proof is in flight", async () => {
    const target = await newTarget();
    const proof = await targets.challenge({ projectId, targetId: target.targetId, expectedRevision: 1, method: "DNS_TXT", challengeHash: challengeHash("proof"), expiresAt: new Date(NOW.getTime() + 600_000) });
    const original = await prisma.qaTargetRevision.findUniqueOrThrow({ where: { id: target.revisionId } });
    await targets.revise({ userId: ownerId, projectId, targetId: target.targetId, expectedRevision: 1, label: "Changed", definition: targetDefinitionSchema.parse(original.definition) });
    await assert.rejects(targets.confirm({ projectId, targetId: target.targetId, revisionId: target.revisionId, verificationId: proof.id, verifiedAt: NOW, validUntil: new Date(NOW.getTime() + 86_400_000) }), { code: "QA_TARGET_VERSION_CONFLICT" });
    assert.equal((await prisma.qaTargetVerification.findUniqueOrThrow({ where: { id: proof.id } })).verifiedAt, null);
  });
  it("keeps v2 dispatch disabled by default without locking or creating a run", async () => {
    const f = await newFixture();
    await assert.rejects(createQaExecutionRepository(prisma, () => NOW, { allowV2: false }).start(f.startInput), { code: "QA_EXECUTION_V2_NOT_ACTIVE" });
    assert.equal(await prisma.qaRun.count({ where: { requestId: f.request.id } }), 0);
    assert.equal((await prisma.qaArtifact.findUniqueOrThrow({ where: { id: f.artifact.id } })).lockedAt, null);
  });
  it("serializes competing approvals and binds exact target, recipe, auth and limits", async () => {
    const f = await newFixture();
    const approvals = await Promise.allSettled([executor.start(f.startInput), executor.start(f.startInput)]);
    assert.equal(approvals.filter(r => r.status === "fulfilled").length, 1);
    const authorization = await prisma.qaExecutionAuthorization.findFirstOrThrow({ where: { recipeId: f.recipe.id } });
    const binding = authorization.binding as Record<string, unknown>;
    assert.equal(authorization.protocolVersion, 2); assert.equal(authorization.targetRevisionId, f.target.revisionId);
    assert.equal(authorization.verificationId, f.proof.id); assert.equal(authorization.requestVersion, f.request.version);
    assert.equal(authorization.bindingHash, hashCanonicalJson(binding));
    assert.deepEqual(binding.authentication, f.profile.authentication); assert.deepEqual(binding.executionLimits, f.profile.executionLimits);
    assert.deepEqual(binding.candidate, f.target.candidate);
    assert.equal(authorization.expiresAt?.getTime(), NOW.getTime() + 600_000);
  });
  it("returns the approved normalized origin only through v2 claims", async () => {
    const f = await approve();
    assert.equal(await executor.claim({ ...f.claimInput, protocolVersion: 1 }), null);
    const response = await executor.claim(f.claimInput) as { task: unknown };
    const task = executionTaskV2Schema.parse(response.task);
    assert.deepEqual(task.profile.target, f.target); assert.equal(task.approval.verificationId, f.proof.id);
  });
  it("rejects unverified targets before creating any execution records", async () => {
    const f = await newFixture();
    await prisma.qaTargetVerification.update({ where: { id: f.proof.id }, data: { verifiedAt: null, validUntil: null } });
    await assert.rejects(executor.start(f.startInput), { code: "QA_TARGET_VERIFICATION_REQUIRED" });
    assert.equal(await prisma.qaRun.count({ where: { requestId: f.request.id } }), 0);
  });
  it("requires new approval after a target revision changes in the queue", async () => {
    const f = await approve();
    const original = await prisma.qaTargetRevision.findUniqueOrThrow({ where: { id: f.target.revisionId } });
    await targets.revise({ userId: ownerId, projectId, targetId: f.target.targetId, expectedRevision: 1, label: "Changed", definition: { ...targetDefinitionSchema.parse(original.definition), baseUrl: "https://changed.example.com/" } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_TARGET_APPROVAL_CHANGED");
  });
  it("does not reuse new proof to silently renew an expired approved proof", async () => {
    const f = await approve();
    await prisma.qaTargetVerification.update({ where: { id: f.proof.id }, data: { verifiedAt: new Date(NOW.getTime() - 86_400_000), validUntil: new Date(NOW.getTime() - 1) } });
    await prisma.qaTargetVerification.create({ data: { revisionId: f.target.revisionId, method: "DNS_TXT", challengeHash: challengeHash("new"), expiresAt: new Date(NOW.getTime() + 600_000), verifiedAt: NOW, validUntil: new Date(NOW.getTime() + 86_400_000) } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_TARGET_VERIFICATION_REQUIRED");
  });
  it("revalidates the target at accept and commits failure before rejecting the runner", async () => {
    const f = await approve();
    const response = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    await prisma.qaTarget.update({ where: { id: f.target.targetId }, data: { currentRevision: 2 } });
    await assert.rejects(executor.accept({ actor: f.claimInput.actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: response.claim }), { code: "QA_TARGET_APPROVAL_CHANGED" });
    await assertFailed(f.job.executionId, "QA_TARGET_APPROVAL_CHANGED");
  });
  for (const operation of ["claim", "accept"] as const) {
    for (const expiry of ["proof", "approval"] as const) {
      it(`commits ${expiry} expiry during ${operation}'s real PostgreSQL target-lock wait`, async () => {
        const f = await approve();
        const claim = operation === "accept" ? await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } } : null;
        if (expiry === "proof") await prisma.qaTargetVerification.update({ where: { id: f.proof.id }, data: { validUntil: new Date(NOW.getTime() + 1_000) } });
        let clock = NOW;
        const delayed = createQaExecutionRepository(prisma, () => clock, { allowV2: true });
        const previousEvents = await prisma.qaWorkflowEvent.count({ where: { requestId: f.request.id, type: { in: ["EXECUTION_STARTED", "EXECUTION_CLAIMED"] } } });
        const result = await whileTargetLocked(f.target.targetId, () => operation === "claim"
          ? delayed.claim(f.claimInput)
          : delayed.accept({ actor: f.claimInput.actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: claim!.claim }),
        () => { clock = new Date(NOW.getTime() + (expiry === "proof" ? 2_000 : 600_001)); });
        const code = expiry === "proof" ? "QA_TARGET_VERIFICATION_REQUIRED" : "QA_EXECUTION_APPROVAL_INVALID";
        if (operation === "claim") { assert.equal(result.status, "fulfilled"); if (result.status === "fulfilled") assert.equal(result.value, null); }
        else { assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason.code, code); }
        await assertFailed(f.job.executionId, code);
        assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: f.job.executionId } })).acceptedAt, null);
        assert.equal(await prisma.qaWorkflowEvent.count({ where: { requestId: f.request.id, type: { in: ["EXECUTION_STARTED", "EXECUTION_CLAIMED"] } } }), previousEvents);
      });
    }
  }
  it("accepts live V2 authority after a real target-lock wait using the fresh decision time", async () => {
    const f = await approve(), response = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    let clock = NOW;
    const delayed = createQaExecutionRepository(prisma, () => clock, { allowV2: true });
    const result = await whileTargetLocked(f.target.targetId,
      () => delayed.accept({ actor: f.claimInput.actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: response.claim }),
      () => { clock = new Date(NOW.getTime() + 2_000); });
    assert.equal(result.status, "fulfilled");
    if (result.status === "fulfilled") assert.equal((result.value as { status: string }).status, "RUNNING");
    const job = await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: f.job.executionId } });
    assert.equal(job.status, "RUNNING"); assert.equal(job.acceptedAt?.getTime(), clock.getTime());
  });
  it('requires a managed runtime before acceptance when the runtime gate is enabled', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const managed = createQaExecutionRepository(prisma, () => NOW, { allowV2: true, requireRuntime: true });
    await assert.rejects(managed.accept({ actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: claimed.claim }), { code: 'QA_EXECUTION_APPROVAL_INVALID' });
    await assertFailed(f.job.executionId, 'QA_EXECUTION_APPROVAL_INVALID');
  });
  it('binds one runtime to the exact claim and preserves owner/project isolation', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const runtime = createBrowserRuntimeRepository(prisma, () => NOW), input = { runtimeId: randomUUID(), imageDigest: `sha256:${'a'.repeat(64)}` };
    await assert.rejects(runtime.begin('other-connection', f.job.executionId, claimed.claim, input), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
    await assert.rejects(runtime.begin(f.connection.id, f.job.executionId, { ...claimed.claim, leaseToken: 'wrong'.repeat(9) }, input), { code: 'BROWSER_RUNTIME_INVALID' });
    await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, input);
    await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, input);
    await assert.rejects(runtime.begin(f.connection.id, f.job.executionId, claimed.claim, { ...input, runtimeId: randomUUID() }), { code: 'BROWSER_RUNTIME_INVALID' });
    assert.equal((await runtime.owned(ownerId, projectId, f.job.executionId)).runtimeId, input.runtimeId);
    await assert.rejects(runtime.owned(otherId, projectId, f.job.executionId), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
    await assert.rejects(runtime.owned(ownerId, otherProjectId, f.job.executionId), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
    const managed = createQaExecutionRepository(prisma, () => NOW, { allowV2: true, requireRuntime: true });
    const receipt = await managed.accept({ actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: claimed.claim }) as { status: string };
    assert.equal(receipt.status, 'RUNNING');
  });
  it('records owner cancellation as requested Stop and rejects fabricated or premature confirmation', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const runtime = createBrowserRuntimeRepository(prisma, () => NOW), input = { runtimeId: randomUUID(), imageDigest: `sha256:${'a'.repeat(64)}` };
    await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, input);
    const exit = { runtimeId: input.runtimeId, processExited: true as const, observedAt: NOW.toISOString() };
    await assert.rejects(runtime.exit(f.connection.id, f.job.executionId, exit), { code: 'BROWSER_RUNTIME_INVALID' });
    await executor.cancel({ actor, projectId, requestId: f.request.id, runId: f.job.runId });
    const requested = await runtime.owned(ownerId, projectId, f.job.executionId);
    assert.equal(requested.state, 'STOP_REQUESTED'); assert.equal(requested.exitObservedAt, null);
    await assert.rejects(runtime.exit(f.connection.id, f.job.executionId, { ...exit, runtimeId: randomUUID() }), { code: 'BROWSER_RUNTIME_INVALID' });
    await assert.rejects(runtime.exit(f.connection.id, f.job.executionId, { ...exit, observedAt: new Date(NOW.getTime() - 1).toISOString() }), { code: 'BROWSER_RUNTIME_INVALID' });
    await runtime.exit(f.connection.id, f.job.executionId, exit);
    assert.equal((await runtime.owned(ownerId, projectId, f.job.executionId)).state, 'STOP_CONFIRMED');
  });
  it('rechecks the runtime lease after a real reaper lock wait instead of stopping a renewed attempt', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const runtimeId = randomUUID();
    await createBrowserRuntimeRepository(prisma, () => NOW).begin(f.connection.id, f.job.executionId, claimed.claim, { runtimeId, imageDigest: `sha256:${'a'.repeat(64)}` });
    let clock = new Date(NOW.getTime() + 46000);
    const reaper = createBrowserRuntimeRepository(prisma, () => clock);
    const result = await whileTargetLocked(f.request.id, () => reaper.reap(), async () => {
      await prisma.qaExecutionJob.update({ where: { id: f.job.executionId }, data: { leaseExpiresAt: new Date(NOW.getTime() + 90000) } });
      clock = new Date(NOW.getTime() + 47000);
    }, 'qa-request');
    assert.equal(result.status, 'fulfilled');
    assert.equal((await runtimeOwned()).state, 'LIVE');
    async function runtimeOwned() { return createBrowserRuntimeRepository(prisma, () => clock).owned(ownerId, projectId, f.job.executionId); }
  });
  it('cannot renew an execution lease that expired during the request-lock wait', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    let clock = NOW;
    const delayed = createQaExecutionRepository(prisma, () => clock, { allowV2: true });
    const result = await whileTargetLocked(f.request.id, () => delayed.heartbeat({ connectionTokenId: f.connection.id,
      executionId: f.job.executionId, lease: claimed.claim, leaseExpiresAt: new Date(NOW.getTime() + 90000) }),
      () => { clock = new Date(NOW.getTime() + 46000); }, 'qa-request');
    assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.reason.code, 'QA_EXECUTION_LEASE_LOST');
    await reapV2Executions(prisma, () => clock);
    await assertFailed(f.job.executionId, 'EXECUTION_INTERRUPTED');
  });
  for (const started of [false, true]) {
    it(`never reclaims a V2 ${started ? 'started' : 'allocated'} attempt after lease loss`, async () => {
      const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
      const runtime = createBrowserRuntimeRepository(prisma, () => NOW);
      await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, { runtimeId: randomUUID(), imageDigest: `sha256:${'a'.repeat(64)}` });
      if (started) await executor.accept({ actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: claimed.claim });
      const afterExpiry = new Date(NOW.getTime() + 45_001), delayed = createQaExecutionRepository(prisma, () => afterExpiry, { allowV2: true });
      assert.equal(await delayed.claim({ ...f.claimInput, leaseExpiresAt: new Date(afterExpiry.getTime() + 45_000) }), null);
      await assertFailed(f.job.executionId, 'EXECUTION_INTERRUPTED');
      assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: f.job.executionId } })).attempts, 1);
    });
  }
  it('independently reaps an interrupted run and leaves Stop unconfirmed without an exit observation', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const runtime = createBrowserRuntimeRepository(prisma, () => NOW);
    await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, { runtimeId: randomUUID(), imageDigest: `sha256:${'a'.repeat(64)}` });
    await executor.accept({ actor, connectionTokenId: f.connection.id, executionId: f.job.executionId, lease: claimed.claim });
    const afterExpiry = new Date(NOW.getTime() + 45_001);
    assert.ok(await reapV2Executions(prisma, () => afterExpiry) >= 1);
    await assertFailed(f.job.executionId, 'EXECUTION_INTERRUPTED');
    const late = createBrowserRuntimeRepository(prisma, () => new Date(afterExpiry.getTime() + 15_001));
    await late.reap();
    const record = await late.owned(ownerId, projectId, f.job.executionId);
    assert.equal(record.state, 'STOP_UNCONFIRMED'); assert.equal(record.exitObservedAt, null);
  });
  for (const [field, value] of Object.entries({ requestVersion: 999, recipeId: "other", recipeHash: "e".repeat(64), artifactId: "other", targetHash: "e".repeat(64), authentication: { kind: "NONE", cookies: "secret" }, executionLimits: { preparationTimeoutMs: 300_000, executionTimeoutMs: 1_000 }, candidate: { reference: "changed", source: "DECLARED" } })) {
    it(`rejects altered authorization ${field} even with a recomputed binding hash`, async () => {
      const f = await approve();
      const authorization = await prisma.qaExecutionAuthorization.findUniqueOrThrow({ where: { runId: f.job.runId } });
      const binding = { ...authorization.binding as Record<string, unknown>, [field]: value };
      await prisma.qaExecutionAuthorization.update({ where: { id: authorization.id }, data: { binding: binding as never, bindingHash: hashCanonicalJson(binding) } });
      assert.equal(await executor.claim(f.claimInput), null);
      await assertFailed(f.job.executionId, "QA_EXECUTION_APPROVAL_INVALID");
    });
  }
  it("rejects a recipe payload changed without changing its recorded hash", async () => {
    const f = await approve();
    const bundle = recipeBundleV1Schema.parse(f.recipe.canonicalJson);
    bundle.items[0].steps[0] = { action: "navigate", path: "/different", ref: "open", waitUntil: "domcontentloaded" };
    await prisma.qaExecutionRecipe.update({ where: { id: f.recipe.id }, data: { canonicalJson: bundle } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_EXECUTION_APPROVAL_INVALID");
  });
  it("commits invalid malformed payloads as failures instead of retrying schema errors", async () => {
    const f = await approve();
    await prisma.qaExecutionRecipe.update({ where: { id: f.recipe.id }, data: { canonicalJson: { engine: "shell", command: "untrusted document instructions" } } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_EXECUTION_APPROVAL_INVALID");
  });
  it("rejects a request version changed after approval", async () => {
    const f = await approve();
    await prisma.qaRequest.update({ where: { id: f.request.id }, data: { version: { increment: 1 } } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_EXECUTION_APPROVAL_INVALID");
  });
  it("does not dispatch a target moved outside the approved project", async () => {
    const f = await approve();
    await prisma.qaTarget.update({ where: { id: f.target.targetId }, data: { projectId: otherProjectId } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_TARGET_APPROVAL_CHANGED");
  });
  it("terminalizes a malformed target snapshot without returning untrusted schema contents", async () => {
    const f = await approve();
    await prisma.qaTargetRevision.update({ where: { id: f.target.revisionId }, data: { definition: { unexpected: "untrusted" } } });
    assert.equal(await executor.claim(f.claimInput), null);
    await assertFailed(f.job.executionId, "QA_TARGET_REVISION_INVALID");
  });
  for (const field of ["baseUrl", "environmentKind", "authentication", "executionLimits"] as const) {
    it(`invalidates a runner profile after ${field} changes`, async () => {
      const f = await approve();
      let changed: ProfileManifestV2 = { ...f.profile, manifestHash: undefined };
      if (field === "baseUrl") changed.target = { ...changed.target, baseUrl: "https://other.example.com/" };
      if (field === "environmentKind") changed = { ...changed, environmentKind: "PRODUCTION", target: { ...changed.target, environmentKind: "PRODUCTION" } };
      if (field === "authentication") changed.authentication = { kind: "SAVED_STATE", id: "other", revision: 1, targetRevisionId: f.target.revisionId };
      if (field === "executionLimits") changed.executionLimits = { ...changed.executionLimits, executionTimeoutMs: 1_000 };
      await prisma.qaRunnerRegistration.update({ where: { id: f.runner.id }, data: { publicProfiles: [resolveProfileManifest(changed)] } });
      assert.equal(await executor.claim(f.claimInput), null);
      await assertFailed(f.job.executionId, "QA_PROFILE_MANIFEST_CHANGED");
    });
  }
  it("blocks saved login until the vault stage and production mutation recipes", async () => {
    const auth = await newFixture("STAGING", true);
    await assert.rejects(executor.start(auth.startInput), { code: "QA_BROWSER_AUTH_NOT_ACTIVE" });
    const mutation = await newFixture("PRODUCTION", false, true);
    await assert.rejects(executor.start(mutation.startInput), { code: "QA_PRODUCTION_RECIPE_ACTION_BLOCKED" });
    const production = await newFixture("PRODUCTION");
    await assert.rejects(executor.start({ ...production.startInput, confirmProduction: false }), { code: "QA_PRODUCTION_CONFIRMATION_REQUIRED" });
    await executor.start(production.startInput);
  });
  it("enforces non-null bindings, proof references and complete verification dates in SQL", async () => {
    const f = await approve();
    await assert.rejects(prisma.$executeRaw`UPDATE "QaExecutionAuthorization" SET "requestVersion" = NULL WHERE "runId" = ${f.job.runId}`);
    await assert.rejects(prisma.$executeRaw`UPDATE "QaExecutionAuthorization" SET "verificationId" = 'missing-proof' WHERE "runId" = ${f.job.runId}`);
    await assert.rejects(prisma.$executeRaw`UPDATE "QaTargetVerification" SET "validUntil" = NULL WHERE "id" = ${f.proof.id}`);
  });
  it('rehearses runtime migration and enforces physical-exit constraints without changing QA history', async () => {
    const f = await approve(), claimed = await executor.claim(f.claimInput) as { claim: { claimId: string; leaseToken: string } };
    const runtime = createBrowserRuntimeRepository(prisma, () => NOW), runtimeId = randomUUID();
    await runtime.begin(f.connection.id, f.job.executionId, claimed.claim, { runtimeId, imageDigest: `sha256:${'a'.repeat(64)}` });
    await assert.rejects(prisma.qaBrowserRuntime.update({ where: { runtimeId }, data: { state: 'STOP_CONFIRMED', stopRequestedAt: NOW } }));
    const pool = new Pool({ connectionString: databaseTarget.connectionString }), client = await pool.connect();
    try {
      await client.query('BEGIN');
      const query = 'SELECT id, status, "protocolVersion", "recipeHash" FROM "QaExecutionJob" WHERE id=$1';
      const before = await client.query(query, [f.job.executionId]);
      await client.query('DROP TABLE "QaBrowserRuntime"');
      await client.query(await readFile(new URL('../prisma/migrations/20261011000100_add_browser_runtime_supervision/migration.sql', import.meta.url), 'utf8'));
      assert.deepEqual((await client.query(query, [f.job.executionId])).rows, before.rows);
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
    assert.equal((await runtime.owned(ownerId, projectId, f.job.executionId)).state, 'LIVE');
  });
  it("rehearses the additive migration over a legacy approval without changing QA history", async () => {
    const f = await approve(), pool = new Pool({ connectionString: databaseTarget.connectionString }), client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fields = 'id, "runId", "recipeId", "artifactId", "approvedByUserId", "runnerRegistrationId", "recipeHash", "profileKey", "profileManifestHash", "productionConfirmed", "approvedAt"';
      const before = await client.query(`SELECT ${fields} FROM "QaExecutionAuthorization" WHERE "runId"=$1`, [f.job.runId]);
      const history = await client.query('SELECT id, phase, version, "selectedArtifactId" FROM "QaRequest" WHERE id=$1', [f.request.id]);
      await client.query('ALTER TABLE "QaExecutionAuthorization" DROP COLUMN "protocolVersion", DROP COLUMN "requestVersion", DROP COLUMN "targetRevisionId", DROP COLUMN "targetHash", DROP COLUMN "verificationId", DROP COLUMN "bindingHash", DROP COLUMN "binding", DROP COLUMN "expiresAt"; DROP TABLE "QaTargetVerification", "QaTargetRevision", "QaTarget" CASCADE');
      await client.query(await readFile(new URL("../prisma/migrations/20261010000100_add_qa_target_approval_v2/migration.sql", import.meta.url), "utf8"));
      assert.deepEqual((await client.query(`SELECT ${fields} FROM "QaExecutionAuthorization" WHERE "runId"=$1`, [f.job.runId])).rows, before.rows);
      assert.deepEqual((await client.query('SELECT id, phase, version, "selectedArtifactId" FROM "QaRequest" WHERE id=$1', [f.request.id])).rows, history.rows);
      const legacy = await client.query('SELECT "protocolVersion", "binding", "targetRevisionId" FROM "QaExecutionAuthorization" WHERE "runId"=$1', [f.job.runId]);
      assert.deepEqual(legacy.rows, [{ protocolVersion: 1, binding: null, targetRevisionId: null }]);
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
  it("deletes owned target history and linked approvals through the project lifecycle", async () => {
    // Move this fixture's complete project into an isolated owner lifecycle for cascade proof.
    const f = await approve();
    const isolated = await prisma.project.create({ data: { ownerId, name: "Cascade rehearsal" } });
    await prisma.$transaction([
      prisma.qaTarget.update({ where: { id: f.target.targetId }, data: { projectId: isolated.id } }),
      prisma.qaRequest.update({ where: { id: f.request.id }, data: { projectId: isolated.id } }),
      prisma.qaExecutionJob.update({ where: { id: f.job.executionId }, data: { projectId: isolated.id } }),
      prisma.qaRunnerRegistration.update({ where: { id: f.runner.id }, data: { projectId: isolated.id } }),
      prisma.projectConnectionToken.update({ where: { id: f.connection.id }, data: { projectId: isolated.id } }),
    ]);
    await prisma.project.delete({ where: { id: isolated.id } });
    assert.equal(await prisma.qaTargetRevision.count({ where: { targetId: f.target.targetId } }), 0);
    assert.equal(await prisma.qaExecutionAuthorization.count({ where: { runId: f.job.runId } }), 0);
  });
  it('keeps human preparation owner-only and prevents Runner acknowledgements from granting input',async()=>{
    const f=await manualFixture();
    await assert.rejects(f.runtime.loginOwned(otherId,manualProjectId,f.job.executionId,f.epoch,'BEGIN'),{code:'BROWSER_RUNTIME_NOT_FOUND'});
    await assert.rejects(f.runtime.loginOwned(ownerId,otherProjectId,f.job.executionId,f.epoch,'BEGIN'),{code:'BROWSER_RUNTIME_NOT_FOUND'});
    await assert.rejects(f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'LOGIN'}),{code:'BROWSER_LOGIN_UNAVAILABLE'});
    await f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN');
    await f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'LOGIN'});
    await f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'CHECK');
    const evidenceInput={connectionTokenId:f.connection.id,executionId:f.job.executionId,lease:f.claimed.claim,checklistItemId:f.item.id,requirementId:'synthetic-unused-requirement'};
    await assert.rejects(f.exec.prepareEvidenceUpload(evidenceInput),{code:'QA_EXECUTION_STATUS_INVALID'});
    assert.equal(await prisma.qaExecutionEvidenceUpload.count({where:{executionJobId:f.job.executionId}}),0);
    await assert.rejects(f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'READY'}),{code:'BROWSER_LOGIN_UNAVAILABLE'});
    await f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'COMPLETE');
    await f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'READY'});
    await assert.rejects(f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN'),{code:'BROWSER_LOGIN_UNAVAILABLE'});
    const receipt=await f.exec.accept({actor:f.claimInput.actor,connectionTokenId:f.connection.id,executionId:f.job.executionId,lease:f.claimed.claim}) as {status:string};
    assert.equal(receipt.status,'RUNNING');
  });
  it('commits an approval failure before rejecting acceptance without completed human preparation',async()=>{
    const f=await manualFixture();
    await assert.rejects(f.exec.accept({actor:f.claimInput.actor,connectionTokenId:f.connection.id,executionId:f.job.executionId,lease:f.claimed.claim}),{code:'QA_EXECUTION_APPROVAL_INVALID'});
    await assertFailed(f.job.executionId,'QA_EXECUTION_APPROVAL_INVALID');
  });
  it('samples preparation authority after a real target-lock wait and requests Stop on expiry',async()=>{
    let clock=NOW;const f=await manualFixture(20000,()=>clock);
    const result=await whileTargetLocked(f.target.targetId,()=>f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN'),()=>{clock=new Date(NOW.getTime()+20001);});
    assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.code,'BROWSER_LOGIN_UNAVAILABLE');
    assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).loginPhase,'WAITING');
    await f.runtime.reap();assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).state,'STOP_REQUESTED');
  });
  it('requests owner Stop without exposing another owner and without inventing physical confirmation',async()=>{
    const f=await manualFixture();
    assert.equal(await f.runtime.requestOwnerStop(otherId,manualProjectId),true);
    assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).state,'LIVE');
    assert.equal(await f.runtime.requestOwnerStop(ownerId,manualProjectId),false);
    assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).state,'STOP_REQUESTED');
    await assert.rejects(f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN'),{code:'BROWSER_LOGIN_UNAVAILABLE'});
    await f.runtime.exit(f.connection.id,f.job.executionId,{runtimeId:f.runtimeId,processExited:true,observedAt:NOW.toISOString()});
    assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).state,'STOP_CONFIRMED');
  });
  it('rechecks the exact ownership proof after a runtime row lock for begin, viewer and Runner acknowledgement',async()=>{
    for(const action of ['BEGIN','VIEWER','ACK'] as const) {
      let clock=NOW; const f=await manualFixture(20000,()=>clock);
      if(action!=='BEGIN')await f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN');
      if(action==='VIEWER')await f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'LOGIN'});
      await prisma.qaTargetVerification.update({where:{id:f.proof.id},data:{validUntil:new Date(NOW.getTime()+1000)}});
      const {createBrowserRuntimeService}=await import('../src/modules/browser-runtime/browser-runtime.service.ts');
      const service=createBrowserRuntimeService({repository:f.runtime,enabled:true,manualEnabled:true,signingKey:'e'.repeat(64),viewerOrigin:'https://viewer.example.test',now:()=>clock});
      const perform:()=>Promise<unknown>=()=>action==='BEGIN'?f.runtime.loginOwned(ownerId,manualProjectId,f.job.executionId,f.epoch,'BEGIN'):
        action==='VIEWER'?service.loginViewer(ownerId,manualProjectId,f.job.executionId):
        f.runtime.loginAck(f.connection.id,f.job.executionId,f.claimed.claim,{runtimeId:f.runtimeId,controlEpoch:f.epoch,phase:'LOGIN'});
      const result=await whileRuntimeLocked(f.job.executionId,perform,()=>{clock=new Date(NOW.getTime()+1001);});
      assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.code,'QA_TARGET_VERIFICATION_REQUIRED');
      assert.equal((await f.runtime.owned(ownerId,manualProjectId,f.job.executionId)).loginPhase,action==='BEGIN'?'WAITING':action==='VIEWER'?'LOGIN':'ENTER_REQUESTED');
    }
  });
  it('cancels queued managed jobs without a runtime and preserves one cancellation in the QA history',async()=>{
    const f=await newFixture('STAGING',false,false,manualProjectId),exec=createQaExecutionRepository(prisma,()=>NOW,{allowV2:true});
    const job=await exec.start(f.startInput),runtime=createBrowserRuntimeRepository(prisma,()=>NOW);
    await runtime.requestOwnerStop(ownerId,manualProjectId);await runtime.requestOwnerStop(ownerId,manualProjectId);
    const row=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId},include:{run:true,request:true}});
    assert.equal(row.status,'CANCELLED');assert.equal(row.run.status,'CANCELLED');assert.equal(row.request.phase,'READY_TO_RUN');
    assert.equal(await prisma.qaWorkflowEvent.count({where:{requestId:f.request.id,type:'EXECUTION_CANCELLED'}}),1);
    assert.equal(await exec.claim(f.claimInput),null);
  });
  for(const winner of ['stop','registration'] as const) it(`fences a late begin/accept when ${winner} acquires the lifecycle lock first`,async()=>{
    const f=await newFixture('STAGING',false,false,manualProjectId),exec=createQaExecutionRepository(prisma,()=>NOW,{allowV2:true,requireRuntime:true});
    const job=await exec.start(f.startInput);await prisma.qaExecutionJob.update({where:{id:job.executionId},data:{availableAt:NOW}});
    const claimed=await exec.claim(f.claimInput) as {claim:{claimId:string;leaseToken:string}};
    const runtime=createBrowserRuntimeRepository(prisma,()=>NOW),input={runtimeId:randomUUID(),imageDigest:`sha256:${'a'.repeat(64)}`};
    let lateBegin:Promise<PromiseSettledResult<unknown>>|undefined,stopResult:Promise<boolean>|undefined;
    if(winner==='stop') {
      const stopped=await whileTargetLocked(f.request.id,()=>runtime.requestOwnerStop(ownerId,manualProjectId),()=>{
        lateBegin=runtime.begin(f.connection.id,job.executionId,claimed.claim,input).then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason}));
      },'qa-request');
      assert.equal(stopped.status,'fulfilled');
      const registered=await lateBegin!;assert.equal(registered.status,'rejected');
      if(registered.status==='rejected')assert.equal(registered.reason.code,'BROWSER_RUNTIME_INVALID');
      assert.equal(await prisma.qaBrowserRuntime.count({where:{executionId:job.executionId}}),0);
    }else {
      const registered=await whileTargetLocked(f.request.id,()=>runtime.begin(f.connection.id,job.executionId,claimed.claim,input),()=>{
        stopResult=runtime.requestOwnerStop(ownerId,manualProjectId);
      },'qa-request');
      assert.equal(registered.status,'fulfilled');assert.equal(await stopResult!,false);
      assert.equal((await runtime.owned(ownerId,manualProjectId,job.executionId)).state,'STOP_REQUESTED');
      await runtime.exit(f.connection.id,job.executionId,{runtimeId:input.runtimeId,processExited:true,observedAt:NOW.toISOString()});
      assert.equal((await runtime.owned(ownerId,manualProjectId,job.executionId)).state,'STOP_CONFIRMED');
    }
    await assert.rejects(exec.accept({actor:f.claimInput.actor,connectionTokenId:f.connection.id,executionId:job.executionId,lease:claimed.claim}),{code:'QA_EXECUTION_LEASE_LOST'});
    const row=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId}});
    assert.equal(row.status,'CANCELLED');assert.equal(row.leaseTokenHash,null);assert.equal(row.leaseExpiresAt,null);
  });
  it('rehearses the additive login migration without restoring human control or changing QA history',async()=>{
    const f=await approve(),pool=new Pool({connectionString:databaseTarget.connectionString}),client=await pool.connect();
    try{
      await client.query('BEGIN');const sql='SELECT id,status,"recipeHash" FROM "QaExecutionJob" WHERE id=$1',before=await client.query(sql,[f.job.executionId]);
      await client.query('ALTER TABLE "QaBrowserRuntime" DROP CONSTRAINT "QaBrowserRuntime_login_phase_check", DROP CONSTRAINT "QaBrowserRuntime_login_binding_check", DROP COLUMN "loginPhase", DROP COLUMN "loginEpoch", DROP COLUMN "loginDeadlineAt"');
      await client.query(await readFile(new URL('../prisma/migrations/20261012000100_add_manual_browser_login/migration.sql',import.meta.url),'utf8'));
      assert.deepEqual((await client.query(sql,[f.job.executionId])).rows,before.rows);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM "QaBrowserRuntime" WHERE "loginPhase"<>\'NONE\'')).rows[0].n,0);
    }finally{await client.query('ROLLBACK');client.release();await pool.end();}
  });
  describe('consented encrypted saved login',()=>{
    const state={cookies:[{name:'fixture',value:'private-cookie',domain:'staging.example.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Strict'}],origins:[{origin:'https://staging.example.com',localStorage:[{name:'session',value:'private-storage'}]}]};
    async function savedFixture(clock=()=>NOW){
      const project=await prisma.project.create({data:{id:prefix+'-vault-'+randomUUID(),ownerId,name:'Vault fixture'}});
      const f=await newFixture('STAGING','MANUAL',false,project.id);
      const vault={storage:{activeVersion:'v1',keys:{v1:'1'.repeat(64)}},transfer:{activeVersion:'t1',keys:{t1:'2'.repeat(64)}},revocations:new BrowserStateRevocations(':memory:','3'.repeat(64))};
      const exec=createQaExecutionRepository(prisma,clock,{allowV2:true,allowManualLogin:true,requireRuntime:true,savedVault:vault});
      const runtime=createBrowserRuntimeRepository(prisma,clock,{allowManualLogin:true,savedVault:vault}),job=await exec.start(f.startInput);
      await prisma.qaExecutionJob.update({where:{id:job.executionId},data:{availableAt:NOW}});const claimed=await exec.claim(f.claimInput) as {claim:{claimId:string;leaseToken:string}}|null;assert.ok(claimed);
      const runtimeId=randomUUID();await runtime.begin(f.connection.id,job.executionId,claimed.claim,{runtimeId,imageDigest:`sha256:${'a'.repeat(64)}`,preparationDeadlineAt:new Date(NOW.getTime()+300000).toISOString()});
      const epoch=(await runtime.owned(ownerId,project.id,job.executionId)).loginEpoch!;
      await runtime.loginOwned(ownerId,project.id,job.executionId,epoch,'BEGIN');await runtime.loginAck(f.connection.id,job.executionId,claimed.claim,{runtimeId,controlEpoch:epoch,phase:'LOGIN'});
      const auth=(await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId},select:{authorization:{select:{bindingHash:true}}}})).authorization;
      const context={purpose:'CAPTURE' as const,executionId:job.executionId,runtimeId,claimId:claimed.claim.claimId,bindingHash:auth.bindingHash!,controlEpoch:epoch,expiresAt:NOW.getTime()+15000};
      const packet={context,packet:sealBrowserState(state,context,vault.transfer)};
      return {...f,project,vault,exec,runtime,job,claimed,runtimeId,epoch,packet};
    }
    async function capture(f:Awaited<ReturnType<typeof savedFixture>>){
      await f.runtime.saveConsentOwned(ownerId,f.project.id,f.job.executionId,f.epoch,true);
      await f.runtime.loginOwned(ownerId,f.project.id,f.job.executionId,f.epoch,'COMPLETE');
      return await f.runtime.captureState(f.connection.id,f.job.executionId,f.claimed.claim,f.packet) as {savedLoginId:string};
    }
    async function savedRun(f:Awaited<ReturnType<typeof savedFixture>>,id:string){
      const next=await newFixture('STAGING',false,false,f.project.id);
      const {manifestHash,...base}=next.profile;
      const profile=resolveProfileManifest(profileManifestV2Schema.parse({...base,target:f.target,authentication:{kind:'SAVED_STATE',id,revision:1,targetRevisionId:f.target.revisionId}}));
      await prisma.qaExecutionRecipe.update({where:{id:next.recipe.id},data:{profileManifest:profile,profileManifestHash:profile.manifestHash}});
      await prisma.qaRunnerRegistration.update({where:{id:next.runner.id},data:{publicProfiles:[profile]}});
      const job=await f.exec.start(next.startInput);await prisma.qaExecutionJob.update({where:{id:job.executionId},data:{availableAt:NOW}});
      const claimed=await f.exec.claim(next.claimInput) as {claim:{claimId:string;leaseToken:string}}|null;assert.ok(claimed);const runtimeId=randomUUID();
      const deadline=(await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId},select:{deadlineAt:true}})).deadlineAt;
      await f.runtime.begin(next.connection.id,job.executionId,claimed.claim,{runtimeId,imageDigest:`sha256:${'a'.repeat(64)}`,preparationDeadlineAt:new Date(Math.min(NOW.getTime()+300000,deadline.getTime())).toISOString()});
      return {...next,job,claimed,runtimeId};
    }
    it('requires explicit consent, seals credentials and never silently extends an idempotent save',async()=>{
      const f=await savedFixture();try{
        await assert.rejects(f.runtime.captureState(f.connection.id,f.job.executionId,f.claimed.claim,f.packet),{code:'BROWSER_LOGIN_UNAVAILABLE'});
        await assert.rejects(f.runtime.saveConsentOwned(otherId,f.project.id,f.job.executionId,f.epoch,true),{code:'BROWSER_RUNTIME_NOT_FOUND'});
        const result=await capture(f),row=await prisma.qaSavedBrowserState.findUniqueOrThrow({where:{id:result.savedLoginId}});
        assert.equal(JSON.stringify(row.sealedState).includes('private-cookie'),false);assert.equal(row.expiresAt.getTime()-row.createdAt.getTime(),7*86400000);
        assert.deepEqual(await f.runtime.captureState(f.connection.id,f.job.executionId,f.claimed.claim,f.packet),result);
        assert.equal((await prisma.qaSavedBrowserState.findUniqueOrThrow({where:{id:result.savedLoginId}})).expiresAt.getTime(),row.expiresAt.getTime());
        const list=await createBrowserAuthRepository(prisma,()=>NOW,()=>f.vault).list(ownerId,f.project.id);assert.equal(JSON.stringify(list).includes('private-cookie'),false);assert.equal(list[0]!.revoked,false);
      }finally{f.vault.revocations.close();}
    });
    it('restores only an exact approved claim and stops active use on revocation, even after a DB restore',async()=>{
      const f=await savedFixture();try{
        const result=await capture(f),retained=await prisma.qaSavedBrowserState.findUniqueOrThrow({where:{id:result.savedLoginId}}),next=await savedRun(f,result.savedLoginId);
        const transfer=await f.runtime.restoreState(next.connection.id,next.job.executionId,next.claimed.claim) as {context:Record<string,unknown>;packet:unknown};
        assert.deepEqual(unsealBrowserState(transfer.packet,transfer.context,f.vault.transfer),state);
        await assert.rejects(f.runtime.restoreState(f.connection.id,next.job.executionId,next.claimed.claim),{code:'BROWSER_RUNTIME_NOT_FOUND'});
        await assert.rejects(f.runtime.restoreState(next.connection.id,next.job.executionId,{...next.claimed.claim,leaseToken:'forged-lease-token'}),{code:'BROWSER_LOGIN_UNAVAILABLE'});
        await f.runtime.loginAck(next.connection.id,next.job.executionId,next.claimed.claim,{runtimeId:next.runtimeId,controlEpoch:transfer.context.controlEpoch as string,phase:'READY'});
        await f.exec.accept({actor:next.claimInput.actor,connectionTokenId:next.connection.id,executionId:next.job.executionId,lease:next.claimed.claim});
        const repo=createBrowserAuthRepository(prisma,()=>NOW,()=>f.vault),revoked=await repo.revoke(ownerId,f.project.id,result.savedLoginId);
        assert.equal(revoked.stopConfirmed,false);assert.equal((await f.runtime.owned(ownerId,f.project.id,next.job.executionId)).state,'STOP_REQUESTED');
        assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:next.job.executionId}})).status,'CANCELLED');
        await prisma.qaSavedBrowserState.update({where:{id:retained.id},data:{revokedAt:null,sealedState:JSON.parse(JSON.stringify(retained.sealedState))}});
        assert.equal((await repo.list(ownerId,f.project.id))[0]!.revoked,true);
        await assert.rejects(savedRun(f,result.savedLoginId),{code:'QA_SAVED_LOGIN_UNAVAILABLE'});
        await f.runtime.exit(next.connection.id,next.job.executionId,{runtimeId:next.runtimeId,processExited:true,observedAt:NOW.toISOString()});
        assert.equal((await repo.revoke(ownerId,f.project.id,result.savedLoginId)).stopConfirmed,true);
      }finally{f.vault.revocations.close();}
    });
    it('refuses changed targets, expired saved authority and transfers that outlive their preparation',async()=>{
      const f=await savedFixture();try{
        const result=await capture(f);
        await prisma.qaSavedBrowserState.update({where:{id:result.savedLoginId},data:{targetHash:'f'.repeat(64)}});
        await assert.rejects(savedRun(f,result.savedLoginId),{code:'QA_SAVED_LOGIN_UNAVAILABLE'});
        await prisma.qaSavedBrowserState.update({where:{id:result.savedLoginId},data:{targetHash:f.target.targetHash,expiresAt:new Date(NOW.getTime()+1000)}});
        // Mutated lifetime no longer matches the externally issued identity.
        await assert.rejects(savedRun(f,result.savedLoginId),{code:'QA_SAVED_LOGIN_UNAVAILABLE'});
        await assert.rejects(f.runtime.captureState(f.connection.id,f.job.executionId,f.claimed.claim,{...f.packet,context:{...f.packet.context,expiresAt:NOW.getTime()+45001}}),{code:'QA_SAVED_LOGIN_UNAVAILABLE'});
      }finally{f.vault.revocations.close();}
    });
    it('does not restore saved authority after it expires during a real PostgreSQL target lock wait',async()=>{
      let time=NOW;const f=await savedFixture(()=>time);try{
        const record={id:randomUUID(),ownerId,projectId:f.project.id,targetRevisionId:f.target.revisionId,targetHash:f.target.targetHash,revision:1,createdAt:new Date(NOW.getTime()-7*86400000+5000),expiresAt:new Date(NOW.getTime()+5000)};
        f.vault.revocations.issue(savedStateBinding(record));await prisma.qaSavedBrowserState.create({data:{...record,sourceRuntimeId:randomUUID(),sealedState:sealBrowserState(state,savedStateBinding(record),f.vault.storage)}});
        const next=await savedRun(f,record.id);assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:next.job.executionId}})).deadlineAt.getTime(),record.expiresAt.getTime());
        const result=await whileTargetLocked(f.target.targetId,()=>f.runtime.restoreState(next.connection.id,next.job.executionId,next.claimed.claim),()=>{time=new Date(record.expiresAt.getTime()+1);});
        assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.code,'QA_SAVED_LOGIN_UNAVAILABLE');
        assert.equal((await f.runtime.owned(ownerId,f.project.id,next.job.executionId)).loginPhase,'WAITING');
      }finally{f.vault.revocations.close();}
    });
    it('retains permanent project deletion tombstones when the deleted record is restored',async()=>{
      const f=await savedFixture();try{
        const result=await capture(f),retained=await prisma.qaSavedBrowserState.findUniqueOrThrow({where:{id:result.savedLoginId}});
        await f.runtime.requestOwnerStop(ownerId,f.project.id);await f.runtime.exit(f.connection.id,f.job.executionId,{runtimeId:f.runtimeId,processExited:true,observedAt:NOW.toISOString()});
        await prisma.$transaction(async tx=>{assert.equal(await lockBrowserDeletion(tx,ownerId,f.project.id),true);await revokeDeletedBrowserScope(tx,ownerId,f.project.id,()=>f.vault);await tx.project.delete({where:{id:f.project.id}});});
        await prisma.project.create({data:{id:f.project.id,ownerId,name:'Restored snapshot'}});
        await prisma.qaSavedBrowserState.create({data:{...retained,sealedState:JSON.parse(JSON.stringify(retained.sealedState))}});
        assert.equal((await createBrowserAuthRepository(prisma,()=>NOW,()=>f.vault).list(ownerId,f.project.id))[0]!.revoked,true);
      }finally{f.vault.revocations.close();}
    });
    it('clears expired encrypted payloads through the existing API reaper cleanup boundary',async()=>{
      const f=await savedFixture();try{
        const result=await capture(f),repo=createBrowserAuthRepository(prisma,()=>new Date(NOW.getTime()+7*86400000+1),()=>f.vault);
        assert.ok(await repo.cleanupExpired()>=1);
        const row=await prisma.qaSavedBrowserState.findUniqueOrThrow({where:{id:result.savedLoginId}});
        assert.deepEqual(row.sealedState,{});assert.ok(row.revokedAt);assert.equal(f.vault.revocations.allows(savedStateBinding(row),NOW.getTime()),false);
      }finally{f.vault.revocations.close();}
    });
  });
});

