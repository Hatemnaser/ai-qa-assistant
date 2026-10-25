import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Pool } from 'pg';
import { targetDefinitionSchema } from '@oddpath/qa-execution-contract';
import { assertPostgresIntegrationTarget } from './helpers/postgresIntegrationTarget.ts';
const database = assertPostgresIntegrationTarget(process.env);
const { prisma } = await import('../src/db/prisma.ts');
const { createReadinessRepository } = await import('../src/modules/readiness/readiness.repository.ts');
const { createReadinessService } = await import('../src/modules/readiness/readiness.service.ts');
const { createReadinessRouter } = await import('../src/modules/readiness/readiness.routes.ts');
const { createQaProvenance } = await import('../src/modules/qa-requests/qa-evidence-provenance.ts');
const { hashCanonicalJson } = await import('../src/lib/canonical-json.ts');
const { hashSessionToken } = await import('../src/modules/auth/auth.security.ts');
const { requireAuth } = await import('../src/modules/auth/auth.middleware.ts');
const { csrfProtection, createCsrfToken } = await import('../src/middleware/csrf.middleware.ts');
const { errorHandler } = await import('../src/middleware/error.middleware.ts');
const { env } = await import('../src/config/env.ts');
const prefix = 'readiness-'+randomUUID(), ownerId = prefix+'-owner', otherId = prefix+'-other', projectId = prefix+'-project';
const pool = new Pool({ connectionString: database.connectionString });
let time = new Date(), deployed = 'build-1', unavailable = false, sequence = 0;
const clock = () => time, repo = createReadinessRepository(prisma, clock), probe = { dns: async () => [], https: async () => { if (unavailable) throw Error('simulated endpoint outage'); return JSON.stringify({ schemaVersion: 1, reference: deployed }); } };
const service = createReadinessService(repo, probe, clock), advance = (ms = 1000) => { time = new Date(time.getTime()+ms); };
before(async () => { await prisma.user.createMany({ data: [{ id: ownerId, email: ownerId+'@example.test', emailVerifiedAt: time }, { id: otherId, email: otherId+'@example.test', emailVerifiedAt: time }] }); await prisma.project.create({ data: { id: projectId, ownerId, name: prefix } }); });
after(async () => { await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } }); await pool.end(); await prisma.$disconnect(); });
async function fixture(optional = false) {
  deployed = 'build-1'; unavailable = false; advance(); const key = prefix+'-'+(++sequence);
  const definition = targetDefinitionSchema.parse({ baseUrl: 'https://staging.example.com/', environmentKind: 'STAGING', candidate: { source: 'DECLARED', reference: 'build-1' } });
  const target = await prisma.qaTarget.create({ data: { projectId, label: key } });
  const revision = await prisma.qaTargetRevision.create({ data: { targetId: target.id, revision: 1, definition, targetHash: hashCanonicalJson(definition), authorityUserId: ownerId } });
  const proof = await prisma.qaTargetVerification.create({ data: { revisionId: revision.id, method: 'DNS_TXT', challengeHash: hashCanonicalJson('fixture'), expiresAt: new Date(time.getTime()+60_000), verifiedAt: time, validUntil: new Date(time.getTime()+7*86_400_000) } });
  const request = await prisma.qaRequest.create({ data: { projectId, title: key, objective: 'Verify release', phase: 'READY_TO_RUN' } });
  const context = await prisma.qaContextSnapshot.create({ data: { requestId: request.id, version: 1, payload: {}, sourceManifest: {}, payloadHash: 'fixture', retrievalMode: 'NONE' } });
  const artifact = await prisma.qaArtifact.create({ data: { requestId: request.id, snapshotId: context.id, revision: 1, origin: 'AGENT_PROVIDED', title: key, canonicalJson: {} } });
  const item = await prisma.qaChecklistItem.create({ data: { artifactId: artifact.id, ordinal: 0, title: 'Heading', expectedResult: 'Heading visible', evidenceRequirements: { create: { ordinal: 0, kind: 'TEXT', description: 'Record actual heading', required: true } } }, include: { evidenceRequirements: true } });
  const second = optional ? await prisma.qaChecklistItem.create({ data: { artifactId: artifact.id, ordinal: 1, title: 'Optional', expectedResult: 'Nice to have' } }) : null;
  await prisma.qaRequest.update({ where: { id: request.id }, data: { selectedArtifactId: artifact.id } });
  const scope = { userId: ownerId, projectId, requestId: request.id }, input = { artifactId: artifact.id, targetId: target.id, reference: 'build-1', verifyDeployment: true, freshnessHours: 24, criteria: [{ itemId: item.id, mandatory: true }, ...(second ? [{ itemId: second.id, mandatory: false }] : [])] };
  const candidate = await service.create(scope, input);
  return { scope, input, candidate, target, revision, proof, artifact, request, item, second };
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  advance(); const started = time; advance();
  const run = await prisma.qaRun.create({ data: { requestId: f.request.id, artifactId: f.artifact.id, status: 'RESULTS_SUBMITTED', outcome: 'PASS', commitSha: 'build-1', createdAt: started, startedAt: started, submittedAt: time } });
  const provenance = createQaProvenance({ actor: { kind: 'USER', transport: 'WEB', userId: ownerId }, projectId, requestId: f.request.id, runId: run.id, artifactId: f.artifact.id, item: f.item, target: f.input.targetId ? 'https://staging.example.com/' : null, environment: 'STAGING', commitSha: 'build-1', targetRevisionId: f.revision.id, targetHash: f.revision.targetHash, recordedAt: time });
  await prisma.qaCheckResult.create({ data: { runId: run.id, checklistItemId: f.item.id, status: 'PASS', observedResult: 'Heading visible', provenance, updatedAt: time } });
  const evidence = await prisma.qaEvidence.create({ data: { runId: run.id, checklistItemId: f.item.id, requirementId: f.item.evidenceRequirements[0]!.id, actorKind: 'USER', transport: 'WEB', kind: 'TEXT', textContent: 'Actual heading is visible', provenance, createdAt: time } });
  if (f.second) await prisma.qaCheckResult.create({ data: { runId: run.id, checklistItemId: f.second.id, status: 'FAIL', observedResult: 'Optional defect', updatedAt: time } });
  return { run, evidence };
}
const assess = (f: Awaited<ReturnType<typeof fixture>>, runId: string | null) => service.evaluate(f.scope, f.candidate.id, { runId });

it('freezes criteria without changing the QA controller, then records a hashed GO snapshot with actual source bindings', async () => {
  const f = await fixture(), { run } = await completed(f), before = await prisma.qaRequest.findUniqueOrThrow({ where: { id: f.request.id } });
  const e = await assess(f, run.id); assert.equal(e.snapshot.decision, 'GO'); assert.equal(e.snapshot.releaseAuthorized, false); assert.equal(e.snapshotHash, hashCanonicalJson(e.snapshot));
  assert.deepEqual(await prisma.qaRequest.findUniqueOrThrow({ where: { id: f.request.id } }), before);
  assert.deepEqual((await repo.list(f.scope)).evaluations[0], e);
});
it('rejects cross-owner reads, candidate creation and evaluation, and runs from other requests', async () => {
  const f = await fixture(), other = await fixture(), { run } = await completed(other), scope = { ...f.scope, userId: otherId };
  await assert.rejects(repo.list(scope), /not found/); await assert.rejects(service.create(scope, f.input), /not found/); await assert.rejects(service.evaluate(scope, f.candidate.id, { runId: null }), /not found/);
  await assert.rejects(assess(f, run.id), /not found/);
});
it('reports missing, failed and blocked checks; rejects mandatory risk acceptance while optional risk is explicit', async () => {
  const f = await fixture(true), { run } = await completed(f);
  assert.equal((await assess(f, null)).snapshot.decision, 'NO_GO'); assert.equal((await assess(f, run.id)).snapshot.decision, 'NO_GO');
  await assert.rejects(service.evaluate(f.scope, f.candidate.id, { runId: run.id, acceptedRisks: [{ itemId: f.item.id, reason: 'Try to waive a mandatory check' }] }), /cannot be waived/);
  const optional = await service.evaluate(f.scope, f.candidate.id, { runId: run.id, acceptedRisks: [{ itemId: f.second!.id, reason: 'Optional issue recorded for the next release' }] }); assert.equal(optional.snapshot.decision, 'GO');
  await prisma.qaCheckResult.update({ where: { runId_checklistItemId: { runId: run.id, checklistItemId: f.item.id } }, data: { status: 'BLOCKED' } }); assert.equal((await assess(f, run.id)).snapshot.criteria[0]!.reason, 'BLOCKED');
});
it('deployment outage cannot produce GO; a mismatching build permanently invalidates the candidate even if it changes back', async () => {
  const f = await fixture(), { run } = await completed(f); unavailable = true; assert.equal((await assess(f, run.id)).snapshot.decision, 'NO_GO');
  unavailable = false; deployed = 'build-2'; assert.equal((await assess(f, run.id)).snapshot.decision, 'NO_GO');
  deployed = 'build-1'; const next = await assess(f, run.id); assert.equal(next.snapshot.decision, 'NO_GO'); assert.ok(next.snapshot.reasons.includes('CANDIDATE_INVALIDATED'));
});
it('criteria cannot be edited or omitted; replacing a candidate cannot reuse old runs or revive an old candidate', async () => {
  const f = await fixture(), { run } = await completed(f); await assert.rejects(service.create(f.scope, { ...f.input, criteria: [] }));
  advance(); const next = await service.create(f.scope, f.input);
  assert.equal((await assess(f, run.id)).snapshot.decision, 'NO_GO');
  const e = await service.evaluate(f.scope, next.id, { runId: run.id }); assert.ok(e.snapshot.reasons.includes('RUN_BEFORE_FREEZE'));
  await assert.rejects(service.create(f.scope, { ...f.input, criteria: [{ itemId: 'unrelated', mandatory: true }] }), /Every checklist/);
});
it('deleted evidence and exact 24-hour boundary revoke GO without silently accepting the retained receipt', async () => {
  const f = await fixture(), { run, evidence } = await completed(f); assert.equal((await assess(f, run.id)).snapshot.decision, 'GO');
  await prisma.qaEvidence.delete({ where: { id: evidence.id } }); assert.equal((await assess(f, run.id)).snapshot.criteria[0]!.reason, 'EVIDENCE_MISSING');
  advance(86_400_000); const e = await assess(f, run.id); assert.equal(e.snapshot.decision, 'NO_GO'); assert.ok(e.snapshot.reasons.includes('RUN_STALE'));
});
it('rechecks proof expiry after a real target lock wait, not the pre-probe clock', async () => {
  const f = await fixture(), { run } = await completed(f), lock = await pool.connect(); let pending: Promise<unknown> | undefined;
  await prisma.qaTargetVerification.update({ where: { id: f.proof.id }, data: { validUntil: new Date(time.getTime()+1000) } });
  try {
    await lock.query('BEGIN'); await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['oddpath:qa-target:'+f.target.id]);
    pending = assess(f, run.id);
    let waited = false;
    for (let i=0;i<500;i++) { const r = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid<>pg_backend_pid()"); if (r.rowCount) { waited=true; break; } await new Promise(r=>setTimeout(r,5)); }
    assert.ok(waited); advance(1001); await lock.query('COMMIT'); const e = await pending as Awaited<ReturnType<typeof assess>>;
    assert.equal(e.snapshot.decision,'NO_GO'); assert.ok(e.snapshot.reasons.includes('OWNERSHIP_UNVERIFIED'));
  } finally { await lock.query('ROLLBACK'); lock.release(); if (pending) await pending; }
});
it('observes a target revision committed while evaluation waits for its lock', async () => {
  const f = await fixture(), { run } = await completed(f), lock = await pool.connect(); let pending: ReturnType<typeof assess> | undefined;
  try {
    await lock.query('BEGIN'); await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['oddpath:qa-target:'+f.target.id]); pending=assess(f,run.id);
    let waited=false; for(let i=0;i<500;i++){const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid<>pg_backend_pid()");if(r.rowCount){waited=true;break;}await new Promise(r=>setTimeout(r,5));}assert.ok(waited);
    const def={...f.revision.definition as object,candidate:{source:'DECLARED',reference:'build-2'}};
    await lock.query('INSERT INTO "QaTargetRevision" (id,"targetId",revision,definition,"targetHash","authorityUserId") VALUES ($1,$2,2,$3,$4,$5)',[randomUUID(),f.target.id,JSON.stringify(def),hashCanonicalJson(def),ownerId]);
    await lock.query('UPDATE "QaTarget" SET "currentRevision"=2 WHERE id=$1',[f.target.id]); await lock.query('COMMIT');
    const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('TARGET_CHANGED'));
  } finally { await lock.query('ROLLBACK');lock.release();if(pending)await pending; }
});
it('serializes simultaneous candidate replacements and invalidates every earlier one', async () => {
  const f=await fixture(); const candidates=await Promise.all([service.create(f.scope,f.input),service.create(f.scope,f.input)]);
  assert.deepEqual(candidates.map(c=>c.revision).sort(),[2,3]);const state=await repo.list(f.scope);assert.equal(state.candidates.filter(c=>!c.invalidatedAt).length,1);assert.equal(state.candidates[0]!.revision,3);
});
it('a run finished during the deployment probe needs a new post-test probe',async()=>{
  const f=await fixture(),{run}=await completed(f);
  let started!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
  const slow=createReadinessService(repo,{dns:async()=>[],https:async()=>{started();await gate;return JSON.stringify({schemaVersion:1,reference:'build-1'});}},clock);
  // A run already incomplete at preparation must no longer start HTTP. Reopen
  // and finish after the probe begins to exercise the original timing assertion.
  const pending=slow.evaluate(f.scope,f.candidate.id,{runId:run.id});await waiting;
  await prisma.qaRun.update({where:{id:run.id},data:{status:'ACTIVE',submittedAt:null}});advance();await prisma.qaRun.update({where:{id:run.id},data:{status:'RESULTS_SUBMITTED',submittedAt:time}});release();
  const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('DEPLOYMENT_BEFORE_RESULTS'));
  assert.equal((await assess(f,run.id)).snapshot.decision,'GO');
});
it('database failure while storing a snapshot never returns GO and a retry stores only one assessment', async () => {
  const f=await fixture(),{run}=await completed(f);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION readiness_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated readiness storage failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER readiness_test_failure BEFORE INSERT ON "QaReadinessEvaluation" FOR EACH ROW EXECUTE FUNCTION readiness_test_failure()`);
  try { await assert.rejects(assess(f,run.id));assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),0); }
  finally {await prisma.$executeRawUnsafe('DROP TRIGGER readiness_test_failure ON "QaReadinessEvaluation"');await prisma.$executeRawUnsafe('DROP FUNCTION readiness_test_failure()');}
  assert.equal((await assess(f,run.id)).snapshot.decision,'GO');assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),1);
});
it('a known build mismatch remains invalidated even when storing its NO_GO snapshot fails', async () => {
  const f=await fixture(),{run}=await completed(f);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION readiness_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated readiness storage failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER readiness_test_failure BEFORE INSERT ON "QaReadinessEvaluation" FOR EACH ROW EXECUTE FUNCTION readiness_test_failure()`);
  try {deployed='build-2';await assert.rejects(assess(f,run.id));assert.ok((await repo.candidate(f.scope,f.candidate.id)).invalidatedAt);}
  finally{await prisma.$executeRawUnsafe('DROP TRIGGER readiness_test_failure ON "QaReadinessEvaluation"');await prisma.$executeRawUnsafe('DROP FUNCTION readiness_test_failure()');}
  deployed='build-1';assert.equal((await assess(f,run.id)).snapshot.decision,'NO_GO');
});
it('QA exports include frozen readiness history; importing the archive never creates live candidates',async()=>{
  const f=await fixture(),{run}=await completed(f);const e=await assess(f,run.id);
  const {createQaReportRepository}=await import('../src/modules/qa-requests/qa-report.repository.ts');
  const {history}=await createQaReportRepository(prisma).read(ownerId,projectId,time,f.request.id);
  assert.equal(history.requests[0]!.readiness![0]!.evaluations[0]!.snapshotHash,e.snapshotHash);
  assert.equal(history.requests[0]!.readiness![0]!.evaluations[0]!.snapshot.historicalOnly,true);
  const before=await prisma.qaReadinessCandidate.count();
  const {addPortableQaHistory,importPortableQaHistory}=await import('../src/modules/data-portability/qa-history-portable.ts');
  const entries=new Map<string,Uint8Array>(),reference=addPortableQaHistory(entries,history);
  const imported=importPortableQaHistory(reference,Object.fromEntries(entries),projectId)!;
  assert.equal(imported.requests[0]!.recordOrigin,'IMPORTED_RECORD');
  await prisma.qaImportedArchive.create({data:{projectId,sourceDigest:hashCanonicalJson(history),payload:imported}});
  assert.equal(await prisma.qaReadinessCandidate.count(),before);
  const all=await createQaReportRepository(prisma).read(ownerId,projectId,time);assert.ok(all.history.requests.some(r=>r.recordOrigin==='IMPORTED_RECORD'&&r.readiness?.length));
});
it('actual HTTP middleware requires session/CSRF, restricts scope and persists a verifiable GO receipt', async () => {
  const f=await fixture(),{run}=await completed(f),sessionToken=randomUUID(),token=createCsrfToken();
  await prisma.session.create({data:{userId:ownerId,tokenHash:hashSessionToken(sessionToken),expiresAt:new Date(Date.now()+86_400_000)}});
  const app=express();app.use(csrfProtection,express.json());app.use('/api/projects/:projectId/qa/requests/:requestId/readiness',requireAuth,createReadinessRouter(service));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${projectId}/qa/requests/${f.request.id}/readiness`;
  try {
    assert.equal((await fetch(url)).status,401);
    const headers={'content-type':'application/json',cookie:`qa_session=${sessionToken}; ${env.csrfCookieName}=${token}`,[env.csrfHeaderName]:token};
    assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json',cookie:`qa_session=${sessionToken}`},body:JSON.stringify(f.input)})).status,403);
    const response=await fetch(url+`/${f.candidate.id}/evaluations`,{method:'POST',headers,body:JSON.stringify({runId:run.id})});assert.equal(response.status,201);
    const body=await response.json() as {evaluation:{snapshot:{decision:string;releaseAuthorized:boolean};snapshotHash:string}};assert.equal(body.evaluation.snapshot.decision,'GO');assert.equal(body.evaluation.snapshot.releaseAuthorized,false);assert.equal(body.evaluation.snapshotHash,hashCanonicalJson(body.evaluation.snapshot));
    assert.equal((await fetch(url.replace(projectId,'other-project'),{headers})).status,404);
    assert.equal((await fetch(url+`/${f.candidate.id}/evaluations`,{method:'POST',headers,body:JSON.stringify({runId:run.id,decision:'GO'})})).status,400);
  }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}
});
it('full application route and a new API process can read history after restart without reopening authority', async () => {
  const f=await fixture(),{run}=await completed(f);await assess(f,run.id);const sessionToken=randomUUID();await prisma.session.create({data:{userId:ownerId,tokenHash:hashSessionToken(sessionToken),expiresAt:new Date(Date.now()+86_400_000)}});
  const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/auth-public-worker.mts'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let output='';child.stderr!.on('data',d=>output+=d);const exit=once(child,'exit');
  try {const[ready]=await Promise.race([once(child,'message'),exit.then(()=>{throw Error(output);})]);const url=`http://127.0.0.1:${(ready as {port:number}).port}/api/projects/${projectId}/qa/requests/${f.request.id}/readiness`;const response=await fetch(url,{headers:{cookie:'qa_session='+sessionToken}});assert.equal(response.status,200);const state=await response.json() as {evaluations:{snapshot:{historicalOnly:boolean;releaseAuthorized:boolean}}[]};assert.equal(state.evaluations[0]!.snapshot.historicalOnly,true);assert.equal(state.evaluations[0]!.snapshot.releaseAuthorized,false);}
  finally {if(child.exitCode===null)child.send('stop');await exit;}
});
it('request deletion cascades readiness records and does not retain a second account identity', async () => {
  const f=await fixture(),{run}=await completed(f);await assess(f,run.id);await prisma.qaRequest.delete({where:{id:f.request.id}});
  assert.equal(await prisma.qaReadinessCandidate.count({where:{id:f.candidate.id}}),0);assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),0);
});
