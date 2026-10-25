import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';

assertPostgresIntegrationTarget(process.env);
// Run standalone: configuration must precede the first application import.
const DAY=86_400_000,WINDOW=40*DAY;
Object.assign(process.env,{AI_GLOBAL_USAGE_WINDOW_MS:String(WINDOW),USAGE_RECORD_RETENTION_DAYS:'32',
 AI_GLOBAL_CREDIT_LIMIT:'1',AI_GLOBAL_REQUEST_LIMIT:'1',AI_GLOBAL_DAILY_CREDIT_LIMIT:'1000',
 AI_GLOBAL_DAILY_REQUEST_LIMIT:'1000',AI_GLOBAL_MONTHLY_CREDIT_LIMIT:'1000',AI_GLOBAL_MONTHLY_REQUEST_LIMIT:'1000',GEMINI_API_KEY:''});
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
const {createRetentionService,getConfiguredRetentionPolicy}=await import('../src/modules/retention/retention.service.ts');
const {createPrismaAccountRepository}=await import('../src/modules/account/account.repository.ts');
const {aggregateQuotaUsage}=await import('../src/modules/usage/usage-quota.ts');
const {AI_USAGE_ACTIONS}=await import('../src/modules/usage/usage.types.ts');
const owners:string[]=[],events:string[]=[];
const policy=getConfiguredRetentionPolicy();
const current=new Date('2039-08-15T12:00:00Z');
async function owner(){const id='retention-window-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:current}});return id;}
function quota(time:Date){return aggregateQuotaUsage(prisma,{since:new Date(time.getTime()-WINDOW),actions:AI_USAGE_ACTIONS});}
function retention(){return createRetentionService(createPrismaRetentionRepository(prisma));}
async function legacy(userId:string,time:Date,action='chat_message'){
 const row=await prisma.usageEvent.create({data:{userId,action,status:'completed',units:1,creditsUsed:1,createdAt:time}});events.push(row.id);return row;
}
async function consumed(userId:string,start:Date,attemptAt=start){
 let clock=start;const repo=createPrismaUsageRepository(prisma,()=>clock);
 const r=await repo.reserveUsage({action:'chat_message',isSignedIn:true,userId,limit:100,requestedUnits:1,since:new Date(start.getTime()-DAY),
  event:{action:'chat_message',userId,model:'gemini-3.1-flash-lite',provider:'gemini',units:1,creditsReserved:1,estimatedTotalTokens:100,status:'reserved',expiresAt:new Date(start.getTime()+60_000)}});
 events.push(r.eventId!);clock=attemptAt;await repo.beginUsageAttempt!(r.eventId!);await repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:1000});return r.eventId!;
}
afterEach(async()=>{await prisma.usageEvent.deleteMany({where:{OR:[{id:{in:events.splice(0)}},{userId:{in:owners}}]}});await prisma.user.deleteMany({where:{id:{in:owners.splice(0)}}});});
after(()=>prisma.$disconnect());

it('R1 keeps the existing 40-day window and 32-day retention compatible without discarding charged usage',async()=>{
 assert.equal(policy.usageDays,32);
 const id=await owner(),eventId=await consumed(id,new Date(current.getTime()-33*DAY));
 const run=await retention().purge(current,policy);assert.equal(run.usageEvents,0);
 assert.deepEqual(await quota(current),{unitsUsed:1,requestCount:1});
 const usage=createUsageService({repository:createPrismaUsageRepository(prisma,()=>current),now:()=>current});
 await assert.rejects(usage.reserveAiOperation({action:'conversation_summary',userId:id,credits:1}),{code:'AI_USAGE_LIMIT_REACHED'});
 assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId}})).creditsUsed,1);
});

it('R2 protects the actual attempt at the inclusive boundary even after the parent createdAt leaves the window',async()=>{
 const id=await owner(),start=new Date(current.getTime()-WINDOW-1000),attempt=new Date(start.getTime()+2000),eventId=await consumed(id,start,attempt);
 const boundary=new Date(attempt.getTime()+WINDOW);
 await retention().purge(boundary,policy);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),1);
 assert.deepEqual(await quota(boundary),{unitsUsed:1,requestCount:1});
 const after=new Date(boundary.getTime()+1);assert.deepEqual(await quota(after),{unitsUsed:0,requestCount:0});
 const purge=await retention().purge(after,policy);assert.equal(purge.usageEvents,1);
 assert.equal(await prisma.usageProviderAttempt.count({where:{eventId}}),0);assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId}}),0);
 const usage=createUsageService({repository:createPrismaUsageRepository(prisma,()=>after),now:()=>after});
 const next=await usage.reserveAiOperation({action:'conversation_summary',userId:id,credits:1});events.push(next.eventId!);assert.ok(next.eventId);
});

it('R3 retains legacy charges for every guarded AI action while draining unrelated and expired usage in small batches',async()=>{
 const id=await owner(),recent=new Date(current.getTime()-33*DAY),expired=new Date(current.getTime()-41*DAY);
 for(const action of AI_USAGE_ACTIONS)await legacy(id,recent,action);
 for(let n=0;n<3;n++)await legacy(id,expired);
 await legacy(id,recent,'asset_upload');
 const drained=await retention().drain(current,policy,2,10);
 assert.equal(drained.usageEvents,4);assert.equal(drained.stopReason,'drained');
 assert.deepEqual(await quota(current),{unitsUsed:AI_USAGE_ACTIONS.length,requestCount:AI_USAGE_ACTIONS.length});
 const later=new Date(recent.getTime()+WINDOW+1);await retention().drain(later,policy,2,10);
 assert.equal(await prisma.usageEvent.count({where:{userId:id}}),0);
});

it('R4 repeated cleanup after account deletion preserves finite ownerless evidence then removes it at its deadline',async()=>{
 const id=await owner(),start=new Date(),eventId=await consumed(id,start);
 await createPrismaAccountRepository(prisma).deleteAccountData(id);
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId},include:{settlementReceipts:true}});
 assert.equal(row.userId,null);assert.ok(row.anonymousUntil);assert.ok(row.anonymousUntil!.getTime()<=start.getTime()+42*DAY);
 assert.ok(!JSON.stringify(row).includes(id));
 await retention().purge(new Date(start.getTime()+33*DAY),policy);await retention().purge(new Date(start.getTime()+40*DAY),policy);
 const same=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId}});assert.equal(same.anonymousUntil!.getTime(),row.anonymousUntil!.getTime());
 await retention().purge(row.anonymousUntil!,policy);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),0);
 assert.equal(await prisma.user.count({where:{id}}),0);
});

it('R5 an old anonymous deadline cannot erase still-active quota after an allowed configuration extension',async()=>{
 const start=new Date(current.getTime()-33*DAY);
 // Persisted metadata from the prior 32-day configuration, now running 40 days.
 for(const status of ['completed','unknown']){
  const row=await prisma.usageEvent.create({data:{action:'chat_message',createdAt:start,units:1,status,creditsUsed:status==='completed'?1:null,anonymousUntil:new Date(start.getTime()+32*DAY),expiresAt:new Date(start.getTime()+60_000),reservationPolicy:{anonymized:true},providerAttempts:1,
   attempts:{create:{ordinal:1,kind:'generation',status,creditsReserved:1,creditsUsed:status==='completed'?1:null,startedAt:start}}}});events.push(row.id);
 }
 await retention().purge(current,policy);assert.equal(await prisma.usageEvent.count({where:{id:{in:events}}}),2);
 assert.deepEqual(await quota(current),{unitsUsed:2,requestCount:2});
 await retention().purge(new Date(start.getTime()+WINDOW+1),policy);assert.equal(await prisma.usageEvent.count({where:{id:{in:events}}}),0);
});

it('R6 concurrent cleanup, duplicate settlement and fresh admission do not release capacity or double-charge',async()=>{
 const a=await owner(),b=await owner(),eventId=await consumed(a,new Date(current.getTime()-33*DAY));
 const repo=createPrismaUsageRepository(prisma,()=>current),usage=createUsageService({repository:repo,now:()=>current});
 const admission=assert.rejects(usage.reserveAiOperation({action:'conversation_summary',userId:b,credits:1}),{code:'AI_USAGE_LIMIT_REACHED'});
 const outcomes=await Promise.allSettled([admission,...Array.from({length:3},()=>retention().purge(current,policy)),...Array.from({length:6},()=>repo.updateUsage({id:eventId,status:'completed',totalTokens:1000}))]);
 assert.deepEqual(outcomes.filter(r=>r.status==='rejected'),[]);
 const e=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId},include:{attempts:true,settlementReceipts:true}});
 assert.equal(e.creditsUsed,1);assert.equal(e.units,1);assert.equal(e.attempts.length,1);assert.equal(e.settlementReceipts.length,1);assert.equal(await prisma.usageEvent.count({where:{userId:b}}),0);
});

it('R7 a fresh service process enforces the persisted budget across cleanup and admits only after the boundary',async()=>{
 const a=await owner(),b=await owner(),start=new Date(current.getTime()-33*DAY),eventId=await consumed(a,start);
 const blocked=await processPass({time:current.toISOString(),owner:b,eventId});
 assert.equal(blocked.eventExists,true);assert.equal(blocked.rejection,'AI_USAGE_LIMIT_REACHED');assert.equal(blocked.providerCalls,0);
 const boundary=new Date(start.getTime()+WINDOW);
 const at=await processPass({time:boundary.toISOString(),owner:b,eventId});assert.equal(at.eventExists,true);assert.equal(at.rejection,'AI_USAGE_LIMIT_REACHED');
 const outside=await processPass({time:new Date(boundary.getTime()+1).toISOString(),owner:b,eventId});
 assert.equal(outside.eventExists,false);assert.equal(outside.rejection,null);events.push(outside.newReservation);assert.equal(outside.providerCalls,0);
});

async function processPass(input:object){
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/quota-retention-worker.mts',JSON.stringify(input)],{env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let errors='';child.stderr!.on('data',data=>errors+=data);
 const exit=once(child,'exit');
 try{
  const [message]=await Promise.race([once(child,'message'),exit.then(()=>{throw new Error('Retention worker exited before proof: '+errors);})]);
  const [code]=await exit;assert.equal(code,0,errors);return message as any;
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
}
