import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {it,after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createQaChecklistIntelligence}=await import('../src/modules/qa-requests/qa-checklist.intelligence.ts');
const {createQaProcessingHandlers}=await import('../src/modules/qa-requests/qa-processing.handlers.ts');
const {createQaProcessingWorker}=await import('../src/modules/qa-requests/qa-processing.worker.ts');
const {createQaProcessingRepository}=await import('../src/modules/qa-requests/qa-processing.repository.ts');
const {createPrismaQaRequestRepository}=await import('../src/modules/qa-requests/qa-requests.repository.ts');
after(()=>prisma.$disconnect());
it('Q1 a PostgreSQL artifact commit failure after LLM success must not automatically buy another generation',async()=>{
 const id='qa-final-'+randomUUID(),pool=new Pool({connectionString:process.env.DATABASE_URL});
 await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:new Date()}});
 const project=await prisma.project.create({data:{ownerId:id,name:'Replay fixture'}});
 const request=await prisma.qaRequest.create({data:{projectId:project.id,createdByUserId:id,title:'Checklist',objective:'Verify page',phase:'GENERATING',contextSnapshots:{create:{version:1,payload:{objective:'Verify page'},sourceManifest:{},payloadHash:'a'.repeat(64),retrievalMode:'lexical'}},executions:{create:{kind:'CHECKLIST_GENERATION',status:'PENDING'}}},include:{executions:true}});
 let clock=new Date(),calls=0;const repo=createPrismaUsageRepository(prisma,()=>clock),usage=createUsageService({repository:repo,now:()=>clock});
 const generator=createQaChecklistIntelligence({model:'gemini-3.1-flash-lite',provider:'gemini',usage,generateText:async p=>{calls++;return {model:p.model!,provider:p.provider!,text:JSON.stringify({title:'Recorded result',items:[{title:'Page opens',steps:['Open page'],expectedResult:'Page visible',evidenceRequirements:[{kind:'TEXT',description:'Observed page'}]}]}),usage:{totalTokens:2000}};}});
 const handlers=createQaProcessingHandlers({database:prisma,repository:createPrismaQaRequestRepository(prisma),generator});
 const worker=()=>createQaProcessingWorker({handlers:{CHECKLIST_GENERATION:handlers.CHECKLIST_GENERATION},repository:createQaProcessingRepository(prisma),now:()=>clock,random:()=>0,maxAttempts:3});
 try{
  await pool.query('CREATE SEQUENCE final_artifact_failures');
  await pool.query(`CREATE FUNCTION final_artifact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId"='${request.id}' AND nextval('final_artifact_failures')=1 THEN RAISE EXCEPTION 'one failed artifact write after successful provider'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER final_artifact_failure BEFORE INSERT ON "QaArtifact" FOR EACH ROW EXECUTE FUNCTION final_artifact_failure()');
  const first=await worker().runOnce({concurrency:1});assert.equal(first.processed,1);assert.equal(first.retried,0);assert.equal(calls,1);assert.equal(await prisma.qaArtifact.count({where:{requestId:request.id}}),1);
  const successfulConsumption=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{settlementReceipts:true}});assert.equal(successfulConsumption.creditsUsed,2);assert.equal(successfulConsumption.settlementReceipts.length,1);
  clock=new Date(clock.getTime()+5001);const second=await worker().runOnce({concurrency:1});
  const records=await prisma.usageEvent.findMany({where:{userId:id}}),job=await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:request.executions[0].id}});
  console.log('Q1_PROOF',JSON.stringify({calls,first,second,jobAttempts:job.attempts,jobStatus:job.status,verifiedCredits:records.reduce((sum,r)=>sum+(r.creditsUsed??0),0),eventCount:records.length,artifacts:await prisma.qaArtifact.count({where:{requestId:request.id}})}));
  assert.equal(job.status,'SUCCEEDED');assert.equal(calls,1,'A database publication retry must reuse the successful result or stop for explicit review');
  assert.equal(records.length,1);assert.equal(records[0].creditsUsed,2);
 }finally{await pool.query('DROP TRIGGER IF EXISTS final_artifact_failure ON "QaArtifact"');await pool.query('DROP FUNCTION IF EXISTS final_artifact_failure()');await pool.query('DROP SEQUENCE IF EXISTS final_artifact_failures');await pool.end();await prisma.usageEvent.deleteMany({where:{userId:id}});await prisma.user.delete({where:{id}});}
});

it('Q2 persistent artifact SQL failure preserves one paid generation and terminates without requeue',async()=>{
 const context=await createPublicationFixture();
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try{
  await pool.query('CREATE SEQUENCE publication_persistent_attempts');
  await pool.query(`CREATE FUNCTION publication_persistent_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId"='${context.request.id}' THEN PERFORM nextval('publication_persistent_attempts'); RAISE EXCEPTION 'artifact storage remains unavailable'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER publication_persistent_failure BEFORE INSERT ON "QaArtifact" FOR EACH ROW EXECUTE FUNCTION publication_persistent_failure()');

  const first=await context.worker().runOnce({concurrency:1});
  assert.equal(first.failed,1);
  assert.equal(first.retried,0);
  assert.equal(context.calls(),1);
  assert.equal((await pool.query('SELECT last_value::int AS count FROM publication_persistent_attempts')).rows[0].count,3);
  const failed=await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:context.executionId}});
  assert.equal(failed.status,'FAILED');
  assert.equal(failed.attempts,1);
  assert.ok(failed.providerStartedAt);
  assert.equal(failed.leaseToken,null);
  assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:context.request.id}})).phase,'PROCESSING_FAILED');
  assert.equal(await prisma.qaArtifact.count({where:{requestId:context.request.id}}),0);
  await assertOnePaidGeneration(context.userId);

  context.advanceClock();
  const next=await context.worker().runOnce({concurrency:1});
  assert.equal(next.processed,0);
  assert.equal(next.retried,0);
  assert.equal(context.calls(),1);
  assert.equal((await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:context.executionId}})).attempts,1);
  console.log('Q2_PUBLICATION_PROOF',JSON.stringify({providerCalls:context.calls(),publicationAttempts:3,jobStatus:failed.status,artifacts:0,verifiedCredits:2}));
 }finally{
  await pool.query('DROP TRIGGER IF EXISTS publication_persistent_failure ON "QaArtifact"');
  await pool.query('DROP FUNCTION IF EXISTS publication_persistent_failure()');
  await pool.query('DROP SEQUENCE IF EXISTS publication_persistent_attempts');
  await pool.end();
  await context.cleanup();
 }
});

it('Q3 lost acknowledgement after a committed checklist reuses that artifact without replay',async()=>{
 const context=await createPublicationFixture();
 const repository=createPrismaQaRequestRepository(prisma);
 const submit=repository.submitChecklist.bind(repository);
 let publicationCalls=0;
 repository.submitChecklist=async command=>{
  publicationCalls++;
  const artifact=await submit(command);
  // The real PostgreSQL transaction committed; only its caller loses the reply.
  if(publicationCalls===1)throw new Error('committed checklist acknowledgement was lost');
  return artifact;
 };
 try{
  const result=await context.worker(repository).runOnce({concurrency:1});
  assert.equal(result.processed,1);
  assert.equal(result.failed,0);
  assert.equal(result.retried,0);
  assert.equal(publicationCalls,1);
  assert.equal(context.calls(),1);
  const job=await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:context.executionId}});
  const artifacts=await prisma.qaArtifact.findMany({where:{requestId:context.request.id},include:{items:true,assessments:true}});
  assert.equal(job.status,'SUCCEEDED');
  assert.equal(job.attempts,1);
  assert.equal(artifacts.length,1);
  assert.equal(job.artifactId,artifacts[0].id);
  assert.equal(artifacts[0].revision,1);
  assert.equal(artifacts[0].title,'Recorded result');
  assert.equal(artifacts[0].items.length,1);
  assert.equal(artifacts[0].assessments.length,1);
  await assertOnePaidGeneration(context.userId);

  context.advanceClock();
  assert.equal((await context.worker(repository).runOnce({concurrency:1})).processed,0);
  assert.equal(context.calls(),1);
  assert.equal(publicationCalls,1);
  console.log('Q3_PUBLICATION_PROOF',JSON.stringify({providerCalls:1,realCommittedPublications:publicationCalls,artifacts:artifacts.length,verifiedCredits:2,jobStatus:job.status}));
 }finally{await context.cleanup();}
});

it('Q4 a killed process after receipt settlement cannot regenerate the lost result in a fresh worker',async()=>{
 const context=await createPublicationFixture();
 let first:Awaited<ReturnType<typeof publicationProcess>>|undefined;
 let recovery:Awaited<ReturnType<typeof publicationProcess>>|undefined;
 try{
  first=await publicationProcess({mode:'pauseBeforePublication',requestId:context.request.id});
  assert.equal(first.message.stage,'before_publication');
  assert.equal(first.message.requestId,context.request.id);
  assert.equal(first.calls(),1);
  const interrupted=await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:context.executionId}});
  assert.equal(interrupted.status,'PROCESSING');
  assert.ok(interrupted.providerStartedAt);
  assert.ok(interrupted.leaseToken);
  await assertOnePaidGeneration(context.userId);
  assert.equal(await prisma.qaArtifact.count({where:{requestId:context.request.id}}),0);

  await first.stop();
  // Expire the dead process's committed lease without waiting for wall time.
  await prisma.qaGenerationExecution.update({where:{id:context.executionId},data:{leaseExpiresAt:new Date(Date.now()-1000)}});
  recovery=await publicationProcess({mode:'recover',requestId:context.request.id});
  assert.equal(recovery.message.stage,'completed');
  assert.equal(recovery.calls(),0,'The replacement process must not invoke the generator');
  assert.equal(recovery.message.result?.failed,1);
  assert.equal(recovery.message.result?.retried,0);
  const failed=await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:context.executionId}});
  assert.equal(failed.status,'FAILED');
  assert.equal(failed.errorCode,'QA_PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(failed.attempts,2);
  assert.equal(failed.leaseToken,null);
  assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:context.request.id}})).phase,'PROCESSING_FAILED');
  assert.equal(await prisma.qaArtifact.count({where:{requestId:context.request.id}}),0);
  await assertOnePaidGeneration(context.userId);
  console.log('Q4_PROCESS_PUBLICATION_PROOF',JSON.stringify({callsBeforeKill:first.calls(),callsAfterRestart:recovery.calls(),jobStatus:failed.status,errorCode:failed.errorCode,artifacts:0,verifiedCredits:2}));
 }finally{
  await first?.stop();
  await recovery?.stop();
  await context.cleanup();
 }
});

async function createPublicationFixture(){
 const userId='qa-publication-'+randomUUID();
 await prisma.user.create({data:{id:userId,email:userId+'@example.test',emailVerifiedAt:new Date()}});
 const project=await prisma.project.create({data:{ownerId:userId,name:'Publication recovery fixture'}});
 const request=await prisma.qaRequest.create({data:{projectId:project.id,createdByUserId:userId,title:'Checklist',objective:'Verify publication recovery',phase:'GENERATING',contextSnapshots:{create:{version:1,payload:{objective:'Verify publication recovery'},sourceManifest:{},payloadHash:'b'.repeat(64),retrievalMode:'lexical'}},executions:{create:{kind:'CHECKLIST_GENERATION',status:'PENDING',availableAt:new Date(0)}}},include:{executions:true}});
 let clock=new Date(),calls=0;
 const usage=createUsageService({repository:createPrismaUsageRepository(prisma,()=>clock),now:()=>clock});
 const generator=createQaChecklistIntelligence({model:'gemini-3.1-flash-lite',provider:'gemini',usage,generateText:async input=>{
  calls++;
  return {model:input.model!,provider:input.provider!,text:JSON.stringify({title:'Recorded result',items:[{title:'Page opens',steps:['Open page'],expectedResult:'Page visible',evidenceRequirements:[{kind:'TEXT',description:'Observed page'}]}]}),usage:{totalTokens:2000}};
 }});
 return {
  userId,request,executionId:request.executions[0].id,calls:()=>calls,
  advanceClock(){clock=new Date(clock.getTime()+60_001);},
  worker(repository=createPrismaQaRequestRepository(prisma)){
   const handlers=createQaProcessingHandlers({database:prisma,repository,generator});
   return createQaProcessingWorker({handlers:{CHECKLIST_GENERATION:handlers.CHECKLIST_GENERATION},repository:createQaProcessingRepository(prisma),now:()=>clock,random:()=>0,maxAttempts:3});
  },
  async cleanup(){await prisma.usageEvent.deleteMany({where:{userId}});await prisma.user.delete({where:{id:userId}});},
 };
}

it('Q5 reads a fresh lease deadline after a real provider-fence row-lock wait',async()=>{
 const context=await createPublicationFixture(),pool=new Pool({connectionString:process.env.DATABASE_URL}),blocker=await pool.connect();
 const {runQaProviderOnce}=await import('../src/modules/qa-requests/qa-processing.persistence.ts');
 let calls=0,pending:Promise<unknown>|undefined;
 try{
  const expiresAt=new Date(Date.now()+1500);
  const job=await createQaProcessingRepository(prisma).claimNext({kinds:['CHECKLIST_GENERATION'],now:new Date(),leaseExpiresAt:expiresAt,leaseToken:randomUUID()});assert.ok(job);
  await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM "QaGenerationExecution" WHERE "id"=$1 FOR UPDATE',[job.id]);
  pending=assert.rejects(runQaProviderOnce(prisma,job,new AbortController().signal,async()=>{calls++;}),{code:'QA_PROCESSING_LEASE_LOST'});
  let observed=false;
  for(let i=0;i<200;i++){
   const waiters=await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%QaGenerationExecution%' AND pid<>pg_backend_pid()");
   if(waiters.rows[0].count>0){observed=true;break;}await new Promise(r=>setTimeout(r,5));
  }
  assert.equal(observed,true,'Must actually wait for the row lock');
  while(Date.now()<=expiresAt.getTime())await new Promise(r=>setTimeout(r,Math.min(50,expiresAt.getTime()-Date.now()+1)));
  await blocker.query('COMMIT');await pending;
  assert.equal(calls,0);assert.equal((await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:job.id}})).providerStartedAt,null);
  console.log('Q5_LEASE_LOCK_PROOF',JSON.stringify({lockWaitObserved:observed,providerCalls:calls,expiredLeaseRejected:true}));
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});await pool.end();await context.cleanup();}
});

async function assertOnePaidGeneration(userId:string){
 const events=await prisma.usageEvent.findMany({where:{userId},include:{attempts:true,settlementReceipts:true}});
 assert.equal(events.length,1);
 assert.equal(events[0].status,'completed');
 assert.equal(events[0].creditsUsed,2);
 assert.equal(events[0].units,2);
 assert.equal(events[0].attempts.length,1);
 assert.equal(events[0].attempts[0].totalTokens,2000);
 assert.equal(events[0].settlementReceipts.length,1);
 assert.equal(events[0].settlementReceipts[0].credits,2);
 assert.ok(events[0].settlementReceipts[0].appliedAt);
}

interface PublicationProcessMessage {
 stage?:'before_publication'|'completed';
 requestId?:string;
 providerCall?:boolean;
 result?:{failed:number;processed:number;retried:number};
}

async function publicationProcess(payload:{mode:'pauseBeforePublication'|'recover';requestId:string}){
 const fixture=fileURLToPath(new URL('./fixtures/qa-publication-recovery-worker.mts',import.meta.url));
 const child=spawn(process.execPath,['--import','tsx',fixture,JSON.stringify(payload)],{
  cwd:fileURLToPath(new URL('../../..',import.meta.url)),env:{...process.env,NODE_ENV:'test'},
  stdio:['ignore','pipe','pipe','ipc'],windowsHide:true,
 });
 let calls=0,errors='';
 assert.ok(child.stderr);
 child.stderr.on('data',data=>errors+=String(data));
 const stop=async()=>{
  if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}
 };
 try{
  const message=await new Promise<PublicationProcessMessage>((resolve,reject)=>{
   const timer=setTimeout(()=>{cleanup();reject(new Error('QA publication fixture timed out: '+errors));},15_000);
   const onMessage=(value:PublicationProcessMessage)=>{
    if(value.providerCall)calls++;
    if(value.stage){cleanup();resolve(value);}
   };
   const onExit=()=>{cleanup();reject(new Error('QA publication fixture exited before its checkpoint: '+errors));};
   const onError=(error:Error)=>{cleanup();reject(error);};
   const cleanup=()=>{clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);child.off('error',onError);};
   child.on('message',onMessage);child.once('exit',onExit);child.once('error',onError);
  });
  return {message,calls:()=>calls,stop};
 }catch(error){await stop();throw error;}
}
