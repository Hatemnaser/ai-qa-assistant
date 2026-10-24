import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {Pool} from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
process.env.GEMINI_API_KEY='offline-final-review-only';
process.env.AI_WORKFLOW_ROUTER_ENABLED='false';
const {prisma}=await import('../src/db/prisma.ts');
const {PrismaClient}=await import('../src/generated/prisma/client.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {createPrismaAccountRepository}=await import('../src/modules/account/account.repository.ts');
const {aggregateQuotaUsage}=await import('../src/modules/usage/usage-quota.ts');
const {AI_USAGE_ACTIONS}=await import('../src/modules/usage/usage.types.ts');
const {env}=await import('../src/config/env.ts');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const owners:string[]=[],anonymousEvents:string[]=[];
async function owner(){const id='final-06b-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:new Date()}});return id;}
afterEach(async()=>{const ids=owners.splice(0),events=anonymousEvents.splice(0);await prisma.usageEvent.deleteMany({where:{OR:[{userId:{in:ids}},{id:{in:events}}]}});await prisma.user.deleteMany({where:{id:{in:ids}}});});
after(async()=>{await pool.end();await prisma.$disconnect();});
const guard={creditLimit:1000,requestLimit:1000,dailyCreditLimit:1000,dailyRequestLimit:1000,monthlyCreditLimit:1000,monthlyRequestLimit:1000,windowMs:3600000};
const request={message:'Hello',history:[],mode:'general' as const,model:'gemini-3.1-flash-lite'};
function chatUsing(usage:any,provider:any){return createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:provider});}
function makeUsage(repo:any,time:()=>Date,policy=guard){return createUsageService({repository:repo,now:time,globalAiUsageGuard:policy});}
function spec(id:string,time:Date){return {action:'chat_message',userId:id,isSignedIn:true,limit:100,requestedUnits:1,since:new Date(time.getTime()-86400000),event:{action:'chat_message',userId:id,status:'reserved',units:1,creditsReserved:1,estimatedTotalTokens:100,model:'gemini-3.1-flash-lite',provider:'gemini',expiresAt:new Date(time.getTime()+60000)}};}

it('A1 one cancelled pre-capture SELECT must not discard an available 2-credit receipt',async()=>{
 const id=await owner();let time=new Date('2037-02-03T12:00:00Z'),calls=0;
 const app='review-capture-'+randomUUID();
 const database=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,application_name:app})});
 const repo=createPrismaUsageRepository(database,()=>time),usage=makeUsage(repo,()=>time),blocker=await pool.connect();
 let cancelledQuery='',cancellation:Promise<void>|undefined;
 try{
  const chat=chatUsing(usage,async(p:any)=>{
   calls++;await blocker.query('BEGIN');await blocker.query('LOCK TABLE "UsageEvent" IN ACCESS EXCLUSIVE MODE');
   cancellation=(async()=>{
    for(let n=0;n<300;n++){
     const result=await pool.query("SELECT pid,query FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT%UsageEvent%'",[app]);
     if(result.rows.length){cancelledQuery=result.rows[0].query;assert.equal((await pool.query('SELECT pg_cancel_backend($1) AS cancelled',[result.rows[0].pid])).rows[0].cancelled,true);await blocker.query('COMMIT');return;}
     await new Promise(r=>setTimeout(r,5));
    }
    await blocker.query('ROLLBACK');throw new Error('Did not observe blocked initial read');
   })();
   return {reply:'answer already generated',model:p.model,provider:p.provider,usage:{totalTokens:2000}};
  });
  const result=await Promise.allSettled([chat.createChatReply(request,{userId:id})]);await cancellation;
  assert.match(cancelledQuery,/"UsageEvent"/);assert.equal(calls,1);
  assert.equal(result[0].status,'fulfilled');
  time=new Date(time.getTime()+1800001);await createPrismaUsageRepository(prisma,()=>time).reconcileExpiredUsage!({strict:true});
  const e=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{settlementReceipts:true,attempts:true}});
  console.log('A1_PROOF',JSON.stringify({cancelledQuery,providerCalls:calls,response:result[0].status,status:e.status,units:e.units,creditsUsed:e.creditsUsed,receipts:e.settlementReceipts.length,tokens:e.attempts[0].totalTokens}));
  assert.equal(e.creditsUsed,2,'A single failed read must retry accounting while actual consumption is still available');
 }finally{await blocker.query('ROLLBACK');blocker.release();await database.$disconnect();}
});

it('A2 deleting an account must not reset global request/credit consumption',async()=>{
 const time=new Date('2037-02-03T13:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),usage=makeUsage(repo,()=>time,{...guard,creditLimit:1,requestLimit:1});let calls=0;
 const chat=chatUsing(usage,async(p:any)=>{calls++;return {reply:'ok',model:p.model,provider:p.provider,usage:{totalTokens:1000}};});
 const a=await owner(),b=await owner();await chat.createChatReply(request,{userId:a});
 await assert.rejects(chat.createChatReply(request,{userId:b}),{code:'AI_USAGE_LIMIT_REACHED'});
 const before=await aggregateQuotaUsage(prisma,{since:new Date(time.getTime()-3600000),actions:AI_USAGE_ACTIONS});
 anonymousEvents.push((await prisma.usageEvent.findFirstOrThrow({where:{userId:a}})).id);
 await createPrismaAccountRepository(prisma).deleteAccountData(a);
 const afterDeletion=await aggregateQuotaUsage(prisma,{since:new Date(time.getTime()-3600000),actions:AI_USAGE_ACTIONS});
 const second=await Promise.allSettled([chat.createChatReply(request,{userId:b})]);
 console.log('A2_PROOF',JSON.stringify({limit:1,calls,before,afterDeletion,second:second[0].status}));
 assert.equal(second[0].status,'rejected','An account privacy action must not reopen consumed global provider budget');
});

it('A3 account deletion during an active provider call must preserve its global hold and recovery identity',async()=>{
 const time=new Date('2037-02-03T14:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),usage=makeUsage(repo,()=>time,{...guard,creditLimit:1,requestLimit:1});
 const a=await owner(),b=await owner();let resolveFirst:any,firstEntered:any;const entered=new Promise<void>(r=>firstEntered=r);let calls=0;
 const chat=chatUsing(usage,async(p:any)=>{calls++;if(calls===1){firstEntered();await new Promise(r=>resolveFirst=r);}return {reply:'ok',model:p.model,provider:p.provider,usage:{totalTokens:2000}};});
 const first=Promise.allSettled([chat.createChatReply(request,{userId:a})]);await entered;
 const original=await prisma.usageEvent.findFirstOrThrow({where:{userId:a}});
 anonymousEvents.push(original.id);
 let deleted=false;try{await createPrismaAccountRepository(prisma).deleteAccountData(a);deleted=true;}finally{resolveFirst();}
 const firstResult=await first;
 const hold=await aggregateQuotaUsage(prisma,{since:new Date(time.getTime()-3600000),actions:AI_USAGE_ACTIONS});
 const second=await Promise.allSettled([chat.createChatReply(request,{userId:b})]);
 console.log('A3_PROOF',JSON.stringify({deleted,calls,hold,originalEventExists:Boolean(await prisma.usageEvent.findUnique({where:{id:original.id}})),first:firstResult[0].status==='rejected'?firstResult[0].reason.code:'success',second:second[0].status}));
 assert.equal(second[0].status,'rejected','Deleting a user must not erase a still-running provider exposure');
 const retained=await prisma.usageEvent.findUniqueOrThrow({where:{id:original.id},include:{settlementReceipts:true}});
 assert.equal(retained.userId,null);assert.equal(retained.creditsUsed,2);assert.ok(retained.anonymousUntil);assert.equal(firstResult[0].status,'fulfilled');
 await assert.rejects(repo.beginUsageAttempt!(original.id),{code:'AI_RESERVATION_EXPIRED'});
});

it('C1 concurrent conflicting receipts select exactly one immutable debit and preserve the other unknown attempt',async()=>{
 const id=await owner(),time=new Date('2037-02-03T16:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),r=await repo.reserveUsage(spec(id,time));
 await repo.beginUsageAttempt!(r.eventId!);await repo.beginUsageAttempt!(r.eventId!);
 const attempts=await prisma.usageProviderAttempt.findMany({where:{eventId:r.eventId},orderBy:{ordinal:'asc'}});
 const results=await Promise.allSettled([2,3].map(credits=>repo.updateUsage({id:r.eventId!,attemptId:attempts[1].id,status:'completed',creditsUsed:credits,usageConfirmed:true})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.some(r=>r.status==='rejected'&&r.reason.code==='AI_USAGE_RECEIPT_CONFLICT'));
 const e=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{settlementReceipts:true}});
 assert.equal(e.settlementReceipts.length,1);assert.equal(e.status,'partial');assert.equal(e.units,e.creditsUsed!+1);
 await Promise.all(Array.from({length:6},()=>repo.updateUsage({id:r.eventId!,attemptId:attempts[0].id,status:'completed',creditsUsed:0,usageConfirmed:true})));
 await repo.updateUsage({id:r.eventId!,status:'failed',units:0});
 const settled=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{settlementReceipts:true}});
 assert.equal(settled.status,'completed');assert.equal(settled.units,e.creditsUsed);assert.equal(settled.settlementReceipts.length,2);
 console.log('C1_PROOF',JSON.stringify({winningCredits:e.creditsUsed,unknownExposure:e.units,finalCredits:settled.creditsUsed,receipts:2}));
});

it('C2 first capture connection loss is retried without replaying the provider',async()=>{
 const id=await owner(),time=new Date('2037-02-03T17:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),usage=makeUsage(repo,()=>time);let calls=0;
 await pool.query('CREATE SEQUENCE final_capture_failures');
 await pool.query(`CREATE FUNCTION final_capture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('final_capture_failures')=1 THEN PERFORM pg_terminate_backend(pg_backend_pid()); END IF; RETURN NEW; END $$`);
 await pool.query('CREATE TRIGGER final_capture_failure BEFORE INSERT ON "UsageSettlementReceipt" FOR EACH ROW EXECUTE FUNCTION final_capture_failure()');
 try{
  await chatUsing(usage,async(p:any)=>{calls++;return {reply:'ok',model:p.model,provider:p.provider,usage:{totalTokens:2000}};}).createChatReply(request,{userId:id});
  const e=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{settlementReceipts:true}});
  const attempts=(await pool.query('SELECT last_value::int AS count FROM final_capture_failures')).rows[0].count;
  assert.equal(calls,1);assert.equal(e.creditsUsed,2);assert.equal(e.settlementReceipts.length,1);assert.equal(attempts,2);
  console.log('C2_PROOF',JSON.stringify({calls,captureAttempts:attempts,credits:e.creditsUsed,receipts:1}));
 }finally{await pool.query('DROP TRIGGER final_capture_failure ON "UsageSettlementReceipt"');await pool.query('DROP FUNCTION final_capture_failure()');await pool.query('DROP SEQUENCE final_capture_failures');}
});

it('C3 month rollover rejects the old reservation but a late actual receipt stays attached to its original attempt window',async()=>{
 const id=await owner();let time=new Date('2037-01-31T23:59:59Z');const repo=createPrismaUsageRepository(prisma,()=>time),usage=makeUsage(repo,()=>time,{...guard,creditLimit:2,requestLimit:2,monthlyCreditLimit:1,monthlyRequestLimit:1});
 const reservation=await usage.reserveAiOperation({action:'conversation_summary',credits:1,model:'gemini-3.1-flash-lite',provider:'gemini',userId:id});await usage.recordAiOperationAttempt(reservation);
 time=new Date('2037-02-01T00:00:01Z');await assert.rejects(usage.recordAiOperationAttempt(reservation),{code:'AI_RESERVATION_EXPIRED'});
 await usage.completeAiOperation(reservation,{totalTokens:1000});
 const currentMonth=await aggregateQuotaUsage(prisma,{since:new Date('2037-02-01T00:00:00Z'),actions:AI_USAGE_ACTIONS});
 assert.equal(currentMonth.unitsUsed,0);assert.equal(currentMonth.requestCount,0);
 const next=await usage.reserveAiOperation({action:'conversation_summary',credits:1,model:'gemini-3.1-flash-lite',provider:'gemini',userId:id});await usage.recordAiOperationAttempt(next);
 await assert.rejects(usage.reserveAiOperation({action:'conversation_summary',credits:1,model:'gemini-3.1-flash-lite',provider:'gemini',userId:id}),{code:'AI_USAGE_LIMIT_REACHED'});
 console.log('C3_PROOF',JSON.stringify({currentMonthBeforeNext:currentMonth,oldAttemptCount:1,newAttemptCount:1}));
});
