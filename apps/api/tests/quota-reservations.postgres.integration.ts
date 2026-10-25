import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,describe,it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
import type {UsageReservationInput} from '../src/modules/usage/usage.types.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {AppError}=await import('../src/lib/errors.ts');
const {env}=await import('../src/config/env.ts');
const {calculateCreditsFromTokenUsage}=await import('../src/modules/usage/credit-policy.ts');
const {createQaExecutionRepository,reapV2Executions}=await import('../src/modules/qa-requests/qa-execution.repository.ts');
const {createBrowserRuntimeRepository}=await import('../src/modules/browser-runtime/browser-runtime.repository.ts');
const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
const owners:string[]=[];
after(()=>prisma.$disconnect());
async function owner(){const id='quota-dbit-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test'}});return id;}
afterEach(async()=>{const ids=owners.splice(0);await prisma.usageEvent.deleteMany({where:{userId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});});
function usageInput(userId:string,time:Date,limit=100):UsageReservationInput{
 return {action:'chat_message',isSignedIn:true,userId,limit,requestedUnits:1,since:new Date(time.getTime()-86_400_000),scopeActions:['chat_message'],inFlightLimit:3,
  event:{action:'chat_message',userId,model:'gemini-3.1-flash-lite',provider:'gemini',creditsReserved:1,estimatedTotalTokens:100,status:'reserved',units:1,expiresAt:new Date(time.getTime()+60_000)}};
}

describe('06B durable usage ledger',{concurrency:false},()=>{
 it('reserves every concrete Auto attempt before the provider and settles using each model',async()=>{
  const id=await owner(),time=new Date(),repository=createPrismaUsageRepository(prisma,()=>time);
  const usage=createUsageService({repository,now:()=>time,globalAiUsageGuard:{creditLimit:1_000_000,dailyCreditLimit:1_000_000,monthlyCreditLimit:1_000_000,requestLimit:10000,dailyRequestLimit:10000,monthlyRequestLimit:10000,windowMs:60_000}});
  const calls:string[]=[];
  const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async input=>{
   const persisted=await prisma.usageProviderAttempt.findFirstOrThrow({where:{event:{userId:id}},orderBy:{ordinal:'desc'}});
   assert.equal(persisted.model,input.model);assert.equal(persisted.status,'started');calls.push(input.model!);
   if(calls.length===1)throw new AppError('Synthetic quota',429,'QUOTA_EXCEEDED');
   return {reply:'Done',model:input.model!,provider:input.provider,usage:{inputTokens:50,outputTokens:50,totalTokens:100}};
  }});
  const reply=await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'auto'},{userId:id});
  assert.equal(calls.length,2);
  const event=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:{orderBy:{ordinal:'asc'}}}});
  assert.equal(event.status,'partial');assert.equal(event.providerAttempts,2);
  assert.deepEqual(event.attempts.map(row=>row.model),calls);assert.deepEqual(event.attempts.map(row=>row.status),['unknown','completed']);
  const charged=event.fixedCredits+event.attempts[0].creditsReserved+calculateCreditsFromTokenUsage({model:calls[1],totalTokens:100});
  assert.equal(event.units,charged);assert.equal(reply.usage?.used,charged);
  assert.equal(event.creditsUsed,charged-event.attempts[0].creditsReserved);
  assert.equal(reply.usage?.accountingStatus,'unconfirmed');
  // A new service/repository instance and a duplicate failure cannot erase a charge.
  await createPrismaUsageRepository(prisma).updateUsage({id:event.id,status:'failed',units:0,creditsUsed:0,providerAttempts:0});
  assert.equal(await createPrismaUsageRepository().readUsageCharge!(event.id),charged);
 });
 it('serializes additional attempts against identity credit limits',async()=>{
  const id=await owner(),time=new Date(),repository=createPrismaUsageRepository(prisma,()=>time);
  const a=await repository.reserveUsage(usageInput(id,time,3)),b=await repository.reserveUsage(usageInput(id,time,3));
  await repository.beginUsageAttempt!(a.eventId!);await repository.beginUsageAttempt!(b.eventId!);
  const results=await Promise.allSettled([repository.beginUsageAttempt!(a.eventId!),createPrismaUsageRepository(prisma,()=>time).beginUsageAttempt!(b.eventId!)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(await prisma.usageProviderAttempt.count({where:{event:{userId:id}}}),3);
  assert.equal((await prisma.usageEvent.aggregate({where:{userId:id},_sum:{units:true}}))._sum.units,3);
 });
 it('counts fallback calls against the global request guard',async()=>{
  const id=await owner(),time=new Date(),repository=createPrismaUsageRepository(prisma,()=>time),input=usageInput(id,time);
  input.globalGuard={creditLimit:1_000_000,requestLimit:1,since:time,staleReservedCutoff:new Date(time.getTime()-60_000)};
  const reservation=await repository.reserveUsage(input);await repository.beginUsageAttempt!(reservation.eventId!);
  await assert.rejects(()=>repository.beginUsageAttempt!(reservation.eventId!),{code:'AI_USAGE_LIMIT_REACHED'});
  assert.equal(await prisma.usageProviderAttempt.count({where:{eventId:reservation.eventId}}),1);
 });
 it('reconciles abandoned calls after restart and refunds only reservations with no call',async()=>{
  const id=await owner();let clock=new Date();const repository=createPrismaUsageRepository(prisma,()=>clock);
  const started=await repository.reserveUsage(usageInput(id,clock)),uncalled=await repository.reserveUsage(usageInput(id,clock));
  await repository.beginUsageAttempt!(started.eventId!);
  clock=new Date(clock.getTime()+60_001);
  await createPrismaUsageRepository(prisma,()=>clock).reconcileExpiredUsage!();
  const rows=await prisma.usageEvent.findMany({where:{userId:id},orderBy:{createdAt:'asc'}});
  assert.ok(rows.every(row=>row.status==='unknown'));assert.equal(rows.find(row=>row.id===started.eventId)!.units,1);assert.equal(rows.find(row=>row.id===uncalled.eventId)!.units,0);
  await assert.rejects(()=>repository.beginUsageAttempt!(started.eventId!),{code:'AI_RESERVATION_EXPIRED'});
 });
 it('reads a fresh clock after waiting for the quota lock',async()=>{
  const id=await owner();let clock=new Date();const repository=createPrismaUsageRepository(prisma,()=>clock),reservation=await repository.reserveUsage(usageInput(id,clock));
  const pool=new Pool({connectionString:process.env.DATABASE_URL}),blocker=await pool.connect();
  try{
   await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtext('usage_quota'),hashtext('ai_operation:global'))");
   const pending=assert.rejects(repository.beginUsageAttempt!(reservation.eventId!),{code:'AI_RESERVATION_EXPIRED'});
   // Prove this transaction actually waits; no sleeps determine the outcome.
   for(let index=0;index<200;index++){
    const waiting=await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid()");
    if(waiting.rows[0].count>0)break;if(index===199)assert.fail('No advisory-lock waiter observed');await new Promise(resolve=>setTimeout(resolve,5));
   }
   clock=new Date(clock.getTime()+60_001);await blocker.query('COMMIT');
   await pending;
   assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}})).status,'unknown');
   assert.equal(await prisma.usageProviderAttempt.count({where:{eventId:reservation.eventId}}),0);
  }finally{await blocker.query('ROLLBACK');blocker.release();await pool.end();}
 });
 it('reconciles a late real receipt once without permitting another expired call',async()=>{
  const id=await owner();let clock=new Date();const repository=createPrismaUsageRepository(prisma,()=>clock),input=usageInput(id,clock);
  input.requestedUnits=3;input.event={...input.event,units:3,creditsReserved:3,estimatedTotalTokens:env.usageTokensPerCredit*3};
  const reservation=await repository.reserveUsage(input);await repository.beginUsageAttempt!(reservation.eventId!);
  clock=new Date(clock.getTime()+60_001);await repository.reconcileExpiredUsage!();
  assert.equal(await repository.readUsageCharge!(reservation.eventId!),3);
  await assert.rejects(()=>repository.beginUsageAttempt!(reservation.eventId!),{code:'AI_RESERVATION_EXPIRED'});
  await repository.updateUsage({id:reservation.eventId!,status:'completed',units:1,model:'gemini-3.1-flash-lite',totalTokens:100});
  await repository.updateUsage({id:reservation.eventId!,status:'failed',units:0,creditsUsed:0});
  const event=await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId},include:{attempts:true}});
  assert.equal(event.status,'completed');assert.equal(event.units,1);assert.equal(event.attempts[0].totalTokens,100);assert.equal(event.attempts[0].status,'completed');
 });
});

describe('06B durable browser capacity',{concurrency:false},()=>{
 it('rejects an approval that expires while waiting for the capacity lock without consuming a daily allocation',async()=>{
  const id=await owner();let clock=new Date();const fixture=await quotaBrowserFixture(prisma,id,clock);
  const executor=createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true});
  const pool=new Pool({connectionString:process.env.DATABASE_URL}),blocker=await pool.connect();
  try{
   await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('oddpath:browser-capacity',0))");
   const pending=assert.rejects(executor.start(fixture.start),{code:'QA_EXECUTION_APPROVAL_INVALID'});
   for(let index=0;index<200;index++){
    const waiting=await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid()");
    if(waiting.rows[0].count>0)break;if(index===199)assert.fail('No capacity-lock waiter observed');await new Promise(resolve=>setTimeout(resolve,5));
   }
   clock=new Date(clock.getTime()+600_001);await blocker.query('COMMIT');await pending;
   assert.equal(await prisma.qaExecutionJob.count({where:{projectId:fixture.project.id}}),0);
   assert.equal(await prisma.qaBrowserDailyUsage.count({where:{ownerId:id}}),0);
  }finally{await blocker.query('ROLLBACK');blocker.release();await pool.end();}
 });
 it('limits one pending allocation per account across projects without orphaning a rejected run',async()=>{
  const id=await owner(),time=new Date(),a=await quotaBrowserFixture(prisma,id,time),b=await quotaBrowserFixture(prisma,id,time);
  const executor=createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true});
  const results=await Promise.allSettled([executor.start(a.start),executor.start(b.start)]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(await prisma.qaExecutionJob.count({where:{project:{ownerId:id}}}),1);
  assert.equal(await prisma.qaRun.count({where:{request:{project:{ownerId:id}}}}),1);
  assert.equal((await prisma.qaBrowserDailyUsage.findFirstOrThrow({where:{ownerId:id}})).count,1);
 });
 it('retains occupied capacity after lease loss until actual Stop confirmation',async()=>{
  const aId=await owner(),bId=await owner();let clock=new Date();
  const a=await quotaBrowserFixture(prisma,aId,clock),b=await quotaBrowserFixture(prisma,bId,new Date(clock.getTime()+1));
  const executor=createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true});
  const aJob=await executor.start(a.start);clock=new Date(clock.getTime()+2);const bJob=await executor.start(b.start);
  await prisma.qaExecutionJob.updateMany({where:{id:{in:[aJob.executionId,bJob.executionId]}},data:{availableAt:clock}});
  const [first,second]=await Promise.all([executor.claim(a.claim),createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true}).claim(b.claim)]);
  const aClaim=first as {claim:{claimId:string;leaseToken:string}};
  assert.ok(aClaim,JSON.stringify(await prisma.qaExecutionJob.findMany({where:{id:{in:[aJob.executionId,bJob.executionId]}},select:{status:true,errorCode:true,errorMessage:true,browserReservation:true}})));
  assert.equal(second,null);
  const runtime=createBrowserRuntimeRepository(prisma,()=>clock),runtimeId=randomUUID();
  await runtime.begin(a.connection.id,aJob.executionId,aClaim.claim,{runtimeId,imageDigest:'sha256:'+'a'.repeat(64)});
  await executor.accept({actor:a.claim.actor,connectionTokenId:a.connection.id,executionId:aJob.executionId,lease:aClaim.claim});
  clock=new Date(clock.getTime()+46_000);await reapV2Executions(prisma,()=>clock);
  await prisma.qaBrowserRuntime.update({where:{runtimeId},data:{state:'STOP_UNCONFIRMED'}});
  const freshClaim={...b.claim,leaseExpiresAt:new Date(clock.getTime()+45_000)};
  assert.equal(await executor.claim(freshClaim),null);
  await runtime.exit(a.connection.id,aJob.executionId,{runtimeId,observedAt:clock.toISOString(),processExited:true});
  const bClaim=await createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true}).claim(freshClaim);assert.ok(bClaim);
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:aJob.executionId}})).state,'RELEASED');
 });
 it('keeps daily consumption when a project is removed and resets on the next UTC day',async()=>{
  const id=await owner();let clock=new Date();const executor=createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true});
  for(let index=0;index<3;index++){
   const fixture=await quotaBrowserFixture(prisma,id,clock);await executor.start(fixture.start);
   await prisma.project.delete({where:{id:fixture.project.id}});
  }
  const blocked=await quotaBrowserFixture(prisma,id,clock);await assert.rejects(()=>executor.start(blocked.start),{code:'BROWSER_DAILY_LIMIT'});
  clock=new Date(clock);clock.setUTCHours(24,0,0,0);
  const next=await quotaBrowserFixture(prisma,id,clock);assert.ok(await executor.start(next.start));
  assert.equal(await prisma.qaBrowserDailyUsage.count({where:{ownerId:id}}),2);
 });
 it('bounds the global queue and frees a cancelled wait without refunding the daily allocation',async()=>{
  const time=new Date(),executor=createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true});
  const ids:string[]=[];
  for(let index=0;index<10;index++){
   const id=await owner();ids.push(id);const fixture=await quotaBrowserFixture(prisma,id,time);await executor.start(fixture.start);
  }
  const nextId=await owner(),next=await quotaBrowserFixture(prisma,nextId,time);
  await assert.rejects(()=>executor.start(next.start),{code:'BROWSER_QUEUE_FULL'});
  assert.equal(await prisma.qaExecutionJob.count({where:{projectId:next.project.id}}),0);
  assert.equal(await createBrowserRuntimeRepository(prisma,()=>time).requestOwnerStop(ids[0]),true);
  assert.ok(await executor.start(next.start));
  assert.equal(await prisma.qaBrowserReservation.count({where:{state:'QUEUED'}}),10);
  assert.equal((await prisma.qaBrowserDailyUsage.findFirstOrThrow({where:{ownerId:ids[0]}})).count,1);
 });
 it('expires queued approvals durably without claiming or starting a browser',async()=>{
  const id=await owner();let clock=new Date();const fixture=await quotaBrowserFixture(prisma,id,clock),executor=createQaExecutionRepository(prisma,()=>clock,{allowV2:true,requireRuntime:true});
  const job=await executor.start(fixture.start);clock=new Date(clock.getTime()+600_001);
  await reapV2Executions(prisma,()=>clock);
  const stored=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId}});
  assert.equal(stored.status,'FAILED');assert.equal(stored.errorCode,'BROWSER_QUEUE_EXPIRED');assert.equal(stored.attempts,0);
  assert.equal(await prisma.qaBrowserRuntime.count({where:{executionId:job.executionId}}),0);
 });
});
