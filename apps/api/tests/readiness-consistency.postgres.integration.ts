import assert from 'node:assert/strict';
import {it} from 'node:test';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {prisma,pool,ownerId,fixture,completed,repo,service,assess,clock,advance,createReadinessService,createReadinessRepository,createReadinessRouter,hashCanonicalJson,hashSessionToken,createCsrfToken,csrfProtection,requireAuth,errorHandler,env} from './helpers/readinessFixture.ts';
import {quotaBrowserFixture} from './helpers/readinessV2Fixture.ts';
const {createQaExecutionRepository}=await import('../src/modules/qa-requests/qa-execution.repository.ts');
const {createBrowserRuntimeRepository}=await import('../src/modules/browser-runtime/browser-runtime.repository.ts');
async function waitUpdate(){for(let i=0;i<400;i++){const r=await pool.query("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()");if(r.rows.some(r=>r.query.includes('UPDATE')&&r.query.includes('QaRun')))return;await new Promise(r=>setTimeout(r,5));}throw Error('Did not observe blocked real QA update');}
it('N1b real v2 result/finish and HTTP deployment response: pre-commit probe must not create GO',async()=>{
 const f=await quotaBrowserFixture(prisma,ownerId,new Date());const scope={userId:ownerId,projectId:f.project.id,requestId:f.request.id};let deployed='build-1',probes=0,probeTime:Date|undefined,trackedRunId:string|undefined;
 const versionEvents:{at:Date;reference:string;runStatus:string|null;manual:boolean}[]=[];
 const versionServer=createServer(async(req,res)=>{probes++;probeTime=new Date();const runStatus=trackedRunId?(await prisma.qaRun.findUniqueOrThrow({where:{id:trackedRunId}})).status:null;versionEvents.push({at:probeTime,reference:deployed,runStatus,manual:!!req.url?.includes('?manual')});res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,reference:deployed}));});versionServer.listen(0,'127.0.0.1');await once(versionServer,'listening');const versionUrl=`http://127.0.0.1:${(versionServer.address() as any).port}/.well-known/oddpath-version`;
 const readiness=createReadinessService(createReadinessRepository(prisma),{dns:async()=>[],https:async()=>{const r=await fetch(versionUrl);return r.text();}});
 const candidate=await readiness.create(scope,{artifactId:f.artifact.id,targetId:f.target.targetId,reference:'build-1',verifyDeployment:true,criteria:[{itemId:f.item.id,mandatory:true}]});
 const executor=createQaExecutionRepository(prisma,()=>new Date(),{allowV2:true,requireRuntime:true}),runtime=createBrowserRuntimeRepository(prisma);
 const job=await executor.start(f.start),claim=await executor.claim({...f.claim,leaseExpiresAt:new Date(Date.now()+45000)});assert.ok(claim);
 const lease=(claim as any).claim,runtimeId=randomUUID(),identity={actor:f.claim.actor,connectionTokenId:f.connection.id,executionId:job.executionId,lease};
 await runtime.begin(f.connection.id,job.executionId,lease,{runtimeId,imageDigest:'sha256:'+'b'.repeat(64)});await executor.accept(identity);
 let run=await prisma.qaRun.findFirstOrThrow({where:{requestId:f.request.id}});const req=await prisma.qaEvidenceRequirement.findFirstOrThrow({where:{checklistItemId:f.item.id}});
 await executor.recordItem({...identity,checklistItemId:f.item.id,submission:{expectedRunVersion:run.version,status:'PASS',notes:'Independent readiness regression',observedResult:'Heading observed by review executor',evidence:[{kind:'TEXT',textContent:'Heading visible',requirementId:req.id}]}});
 run=await prisma.qaRun.findUniqueOrThrow({where:{id:run.id}});const result=await prisma.qaCheckResult.findFirstOrThrow({where:{runId:run.id}});assert.equal((result.provenance as any).target.revisionId,f.target.revisionId);assert.equal((result.provenance as any).build.reference,'build-1');
 trackedRunId=run.id;
 const token=randomUUID(),csrf=createCsrfToken();await prisma.session.create({data:{userId:ownerId,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000)}});
 const app=express();app.use(csrfProtection,express.json());app.use('/api/projects/:projectId/qa/requests/:requestId/readiness',requireAuth,createReadinessRouter(readiness));app.use(errorHandler);const api=app.listen(0,'127.0.0.1');await once(api,'listening');
 const url=`http://127.0.0.1:${(api.address() as any).port}/api/projects/${f.project.id}/qa/requests/${f.request.id}/readiness/${candidate.id}/evaluations`,headers={'content-type':'application/json',cookie:`qa_session=${token}; ${env.csrfCookieName}=${csrf}`,[env.csrfHeaderName]:csrf};
 const blocker=await pool.connect();let finish:Promise<unknown>|undefined,evaluation:Promise<Response>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM "QaRun" WHERE id=$1 FOR UPDATE',[run.id]);finish=executor.finish({...identity,finish:{expectedRunVersion:run.version}});await waitUpdate();
  assert.equal((await prisma.qaRun.findUniqueOrThrow({where:{id:run.id}})).status,'ACTIVE');
  evaluation=fetch(url,{method:'POST',headers,body:JSON.stringify({runId:run.id})});
  let waiting=false;for(let i=0;i<400;i++) {const rows=await pool.query("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid<>pg_backend_pid()");if(rows.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,5));}assert.ok(waiting,'Readiness must reach the QA transaction barrier');const observedProbe=probeTime;console.log('N1B_BARRIER',JSON.stringify({versionRequestsBeforeFinishCommit:probes}));
  deployed='build-2';const changed=await (await fetch(versionUrl+'?manual=1')).json() as any;assert.equal(changed.reference,'build-2');
  await blocker.query('COMMIT');await finish;const finishReturnedAt=new Date();
  const response=await evaluation,body=await response.json() as any;assert.equal(response.status,201);assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId}})).status,'SUCCEEDED');
  console.log('N1B_PROOF',JSON.stringify({httpStatus:response.status,decision:body.evaluation.snapshot.decision,reasons:body.evaluation.snapshot.reasons,lastProbeBeforeCommit:observedProbe,versionEvents,finishReturnedAt,versionAtFinish:changed.reference,actualResultWriter:true,actualV2Finish:true,actualVersionHttp:true,publicTlsProbe:false,snapshot:body.evaluation.snapshot}));
  assert.equal(body.evaluation.snapshot.decision,'NO_GO','The actual v2 writer permits a version probe before its finish becomes visible');
  assert.equal(versionEvents.filter(e=>!e.manual).at(-1)!.runStatus,'RESULTS_SUBMITTED');
 }finally{await blocker.query('ROLLBACK');blocker.release();if(finish)await finish.catch(()=>{});if(evaluation)await evaluation.catch(()=>{});await new Promise<void>(r=>{api.close(()=>r());api.closeAllConnections();});await new Promise<void>(r=>{versionServer.close(()=>r());versionServer.closeAllConnections();});await runtime.requestStop(f.connection.id,job.executionId);await runtime.exit(f.connection.id,job.executionId,{runtimeId,observedAt:new Date().toISOString(),processExited:true});}
});

function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
function pausedProbe(){const entered=gate(),release=gate();let calls=0;return {entered,release,count:()=>calls,service:createReadinessService(repo,{dns:async()=>[],https:async()=>{calls++;entered.release();await release.promise;return JSON.stringify({schemaVersion:1,reference:'build-1'});}},clock)};}

it('incomplete or mandatory-failed QA does not make an unnecessary external version request',async()=>{
 const f=await fixture(),{run}=await completed(f);let calls=0;const s=createReadinessService(repo,{dns:async()=>[],https:async()=>{calls++;return JSON.stringify({schemaVersion:1,reference:'build-1'});}},clock);
 await prisma.qaRun.update({where:{id:run.id},data:{status:'ACTIVE',submittedAt:null}});
 const active=await s.evaluate(f.scope,f.candidate.id,{runId:run.id});assert.equal(active.snapshot.decision,'NO_GO');assert.ok(active.snapshot.reasons.includes('RUN_INCOMPLETE'));assert.equal(calls,0);
 await prisma.qaRun.update({where:{id:run.id},data:{status:'RESULTS_SUBMITTED',submittedAt:clock()}});await prisma.qaCheckResult.updateMany({where:{runId:run.id},data:{status:'FAIL'}});
 assert.equal((await s.evaluate(f.scope,f.candidate.id,{runId:run.id})).snapshot.decision,'NO_GO');assert.equal(calls,0);
});

for(const mutation of ['result content','evidence content','run revision'] as const)it(`a ${mutation} change with unchanged timestamps invalidates the prepared source`,async()=>{
 const f=await fixture(),{run,evidence}=await completed(f),p=pausedProbe();
 const pending=p.service.evaluate(f.scope,f.candidate.id,{runId:run.id});await p.entered.promise;
 try{
  if(mutation==='result content')await prisma.qaCheckResult.updateMany({where:{runId:run.id},data:{observedResult:'Corrected observation',updatedAt:clock()}});
  if(mutation==='evidence content')await prisma.qaEvidence.update({where:{id:evidence.id},data:{textContent:'Corrected proof, same timestamp'}});
  if(mutation==='run revision')await prisma.qaRun.update({where:{id:run.id},data:{version:{increment:2}}});
 }finally{p.release.release();}
 const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('EVALUATION_STATE_CHANGED'));assert.notEqual(e.snapshot.sourceHash,e.snapshot.preparedSourceHash);assert.equal(p.count(),1);
 const retry=await assess(f,run.id);assert.equal(retry.snapshot.decision,'GO');assert.equal(retry.snapshot.sourceHash,retry.snapshot.preparedSourceHash);
});

it('a candidate replacement during HTTP proves locks are released and rejects the earlier observation',async()=>{
 const f=await fixture(),{run}=await completed(f),p=pausedProbe();const pending=p.service.evaluate(f.scope,f.candidate.id,{runId:run.id});await p.entered.promise;
 try{advance();await service.create(f.scope,f.input);}finally{p.release.release();}
 const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('CANDIDATE_INVALIDATED'));assert.ok(e.snapshot.reasons.includes('EVALUATION_STATE_CHANGED'));
});

it('a target revision during HTTP invalidates the candidate without waiting for the network transaction',async()=>{
 const f=await fixture(),{run}=await completed(f),p=pausedProbe();const pending=p.service.evaluate(f.scope,f.candidate.id,{runId:run.id});await p.entered.promise;
 try{
  const {createQaTargetsRepository}=await import('../src/modules/qa-targets/qa-targets.repository.ts');
  await createQaTargetsRepository(prisma,clock).revise({projectId:f.scope.projectId,targetId:f.target.id,userId:ownerId,expectedRevision:1,label:'Changed during version HTTP',definition:{baseUrl:f.candidate.definition.target.baseUrl,environmentKind:'STAGING',authenticationOrigins:[],resourceOrigins:[],candidate:{source:'DECLARED',reference:'build-2'}}});
 }finally{p.release.release();}
 const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('TARGET_CHANGED'));assert.ok((await repo.candidate(f.scope,f.candidate.id)).invalidatedAt);
});

it('an old delayed HTTP body cannot qualify after the observation lifetime expires',async()=>{
 const f=await fixture(),{run}=await completed(f),p=pausedProbe();const pending=p.service.evaluate(f.scope,f.candidate.id,{runId:run.id});await p.entered.promise;advance(300001);p.release.release();
 const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('DEPLOYMENT_STALE'));assert.equal(p.count(),1);
});

it('ownership expiry during HTTP prevents GO even if the source fingerprint is unchanged',async()=>{
 const f=await fixture(),{run}=await completed(f);await prisma.qaTargetVerification.update({where:{id:f.proof.id},data:{validUntil:new Date(clock().getTime()+1000)}});
 const p=pausedProbe(),pending=p.service.evaluate(f.scope,f.candidate.id,{runId:run.id});await p.entered.promise;advance(1000);p.release.release();const e=await pending;
 assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('OWNERSHIP_UNVERIFIED'));assert.equal(e.snapshot.sourceHash,e.snapshot.preparedSourceHash);
});

it('asset expiry during snapshot INSERT wait downgrades and persists NO_GO',async()=>{
 const f=await fixture(),{run,evidence}=await completed(f);
 const asset=await prisma.storedAsset.create({data:{ownerId,projectId:f.scope.projectId,objectKey:'r1/'+evidence.id,purpose:'QA_EVIDENCE',status:'READY',originalName:'proof.png',declaredMimeType:'image/png',detectedMimeType:'image/png',expectedSizeBytes:68,sizeBytes:68,checksumSha256:'a'.repeat(43)+'=',readyAt:clock(),evidenceExpiresAt:new Date(clock().getTime()+1000)}});
 await prisma.qaEvidenceAsset.create({data:{evidenceId:evidence.id,assetId:asset.id,ordinal:0,snapshot:{}}});const lock=await pool.connect();let pending:ReturnType<typeof assess>|undefined;
 await prisma.$executeRawUnsafe(`CREATE FUNCTION r1_insert_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(700118); RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER r1_insert_wait BEFORE INSERT ON "QaReadinessEvaluation" FOR EACH ROW EXECUTE FUNCTION r1_insert_wait()`);
 try{
  await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(700118)');pending=assess(f,run.id);
  let waiting=false;for(let i=0;i<400;i++){const rows=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT%QaReadinessEvaluation%' AND pid<>pg_backend_pid()");if(rows.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,5));}assert.ok(waiting);advance(1000);await lock.query('COMMIT');
  const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.equal(e.snapshot.criteria[0]!.reason,'EVIDENCE_UNAVAILABLE');assert.equal(e.snapshotHash,hashCanonicalJson(e.snapshot));
  const stored=await prisma.qaReadinessEvaluation.findUniqueOrThrow({where:{id:e.id}});assert.equal((stored.snapshot as {decision:string}).decision,'NO_GO');assert.equal(stored.snapshotHash,e.snapshotHash);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending.catch(()=>{});await prisma.$executeRawUnsafe('DROP TRIGGER r1_insert_wait ON "QaReadinessEvaluation"');await prisma.$executeRawUnsafe('DROP FUNCTION r1_insert_wait()');}
});

it('two concurrent evaluations bind the same stable committed state without sharing a probe',async()=>{
 const f=await fixture(),{run}=await completed(f);let calls=0;const s=createReadinessService(repo,{dns:async()=>[],https:async()=>{calls++;return JSON.stringify({schemaVersion:1,reference:'build-1'});}},clock);
 const values=await Promise.all([s.evaluate(f.scope,f.candidate.id,{runId:run.id}),s.evaluate(f.scope,f.candidate.id,{runId:run.id})]);assert.equal(calls,2);assert.ok(values.every(e=>e.snapshot.decision==='GO'));assert.equal(values[0]!.snapshot.sourceHash,values[1]!.snapshot.sourceHash);assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),2);
});

it('a matching probe from before a fresh preparation cannot be replayed even for unchanged source data',async()=>{
 const f=await fixture(),{run}=await completed(f),oldAt=clock().toISOString();advance();const input={runId:run.id,acceptedRisks:[]};
 const preparation=await repo.prepareEvaluation(f.scope,f.candidate.id,input);
 const stale=await repo.evaluate(f.scope,f.candidate.id,input,{status:'MATCH',reference:'build-1',responseHash:'a'.repeat(64),startedAt:oldAt,observedAt:oldAt},preparation);
 assert.equal(stale.snapshot.decision,'NO_GO');assert.ok(stale.snapshot.reasons.includes('DEPLOYMENT_BEFORE_RESULTS'));assert.equal(stale.snapshot.sourceHash,stale.snapshot.preparedSourceHash);
});

it('a lost real HTTP version response is unverified; a new service retries only through a fresh observation',async()=>{
 const f=await fixture(),{run}=await completed(f);let calls=0,lose=true;
 const server=createServer((_req,res)=>{calls++;if(lose){res.destroy();return;}res.end(JSON.stringify({schemaVersion:1,reference:'build-1'}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const probe={dns:async()=>[],https:async()=>{const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/.well-known/oddpath-version`);return response.text();}};
 try{const s=createReadinessService(repo,probe,clock),lost=await s.evaluate(f.scope,f.candidate.id,{runId:run.id});assert.equal(lost.snapshot.decision,'NO_GO');assert.ok(lost.snapshot.reasons.includes('DEPLOYMENT_UNVERIFIED'));assert.equal(calls,1);
  lose=false;const restarted=createReadinessService(createReadinessRepository(prisma,clock),probe,clock);const history=await restarted.list(f.scope);assert.equal(calls,1);assert.equal(history.evaluations[0]!.snapshot.historicalOnly,true);assert.equal(history.evaluations[0]!.snapshot.releaseAuthorized,false);
  assert.equal((await restarted.evaluate(f.scope,f.candidate.id,{runId:run.id})).snapshot.decision,'GO');assert.equal(calls,2);
 }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}
});

it('a build changed during a delayed real HTTP version response permanently invalidates the candidate',async()=>{
 const f=await fixture(),{run}=await completed(f),entered=gate(),release=gate();let deployed='build-1';
 const server=createServer(async(_req,res)=>{entered.release();await release.promise;res.end(JSON.stringify({schemaVersion:1,reference:deployed}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const probe={dns:async()=>[],https:async()=>{const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/.well-known/oddpath-version`);return response.text();}},s=createReadinessService(repo,probe,clock);
 try{const pending=s.evaluate(f.scope,f.candidate.id,{runId:run.id});await entered.promise;deployed='build-2';release.release();const e=await pending;assert.equal(e.snapshot.decision,'NO_GO');assert.ok(e.snapshot.reasons.includes('DEPLOYMENT_CHANGED'));deployed='build-1';assert.equal((await s.evaluate(f.scope,f.candidate.id,{runId:run.id})).snapshot.decision,'NO_GO');assert.ok((await repo.candidate(f.scope,f.candidate.id)).invalidatedAt);}
 finally{release.release();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}
});

it('a lost readiness HTTP response preserves history and retry performs a fresh evaluation',async()=>{
 const f=await fixture(),{run}=await completed(f),saved=gate(),release=gate();let calls=0,delay=true;
 const s=createReadinessService(repo,{dns:async()=>[],https:async()=>{calls++;return JSON.stringify({schemaVersion:1,reference:'build-1'});}},clock),token=randomUUID(),csrf=createCsrfToken();
 await prisma.session.create({data:{userId:ownerId,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000)}});
 const app=express();app.use(csrfProtection,express.json());app.use((req,res,next)=>{const send=res.json.bind(res);res.json=body=>{if(delay&&req.path.endsWith('/evaluations')){saved.release();void release.promise.then(()=>{if(!res.destroyed)send(body);});return res;}return send(body);};next();});
 app.use('/api/projects/:projectId/qa/requests/:requestId/readiness',requireAuth,createReadinessRouter(s));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/projects/${f.scope.projectId}/qa/requests/${f.request.id}/readiness`,headers={'content-type':'application/json',cookie:`qa_session=${token}; ${env.csrfCookieName}=${csrf}`,[env.csrfHeaderName]:csrf},controller=new AbortController();
 try{const pending=fetch(url+`/${f.candidate.id}/evaluations`,{method:'POST',headers,body:JSON.stringify({runId:run.id}),signal:controller.signal}).catch(e=>e);await saved.promise;assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),1);controller.abort();assert.ok(await pending instanceof Error);delay=false;release.release();
  const response=await fetch(url,{headers}),history=await response.json() as {evaluations:{snapshot:{historicalOnly:boolean;releaseAuthorized:boolean}}[]};assert.equal(response.status,200);assert.equal(history.evaluations[0]!.snapshot.historicalOnly,true);assert.equal(history.evaluations[0]!.snapshot.releaseAuthorized,false);assert.equal(calls,1);
  const retry=await fetch(url+`/${f.candidate.id}/evaluations`,{method:'POST',headers,body:JSON.stringify({runId:run.id})});assert.equal(retry.status,201);assert.equal(calls,2);assert.equal(await prisma.qaReadinessEvaluation.count({where:{candidateId:f.candidate.id}}),2);
 }finally{controller.abort();release.release();await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}
});
