import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {AppError}=await import('../src/lib/errors.ts');
const {createConversationSummaryRefreshService}=await import('../src/modules/conversation-summary/conversation-summary-refresh.service.ts');
const {createPrismaConversationSummaryRepository}=await import('../src/modules/conversation-summary/conversation-summary.repository.ts');
const {createConversationSummaryService}=await import('../src/modules/conversation-summary/conversation-summary.service.ts');
const {createConversationSummaryUsageService}=await import('../src/modules/usage/conversation-summary-usage.service.ts');
const {env}=await import('../src/config/env.ts');
const owners:string[]=[];
async function owner(){const id='partial-06b-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:new Date()}});return id;}
afterEach(async()=>{const ids=owners.splice(0);await prisma.usageEvent.deleteMany({where:{userId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});});
after(()=>prisma.$disconnect());
const guard={creditLimit:100,requestLimit:100,dailyCreditLimit:10000,dailyRequestLimit:10000,monthlyCreditLimit:10000,monthlyRequestLimit:10000,windowMs:3600000};
const request={message:'Hello',history:[],mode:'general' as const,model:'auto'};

function reservationInput(userId:string,time:Date){return {action:'chat_message',userId,isSignedIn:true,limit:100,requestedUnits:1,since:new Date(time.getTime()-86400000),event:{action:'chat_message',userId,status:'reserved',units:1,creditsReserved:1,estimatedTotalTokens:100,model:'gemini-3.1-flash-lite',provider:'gemini',expiresAt:new Date(time.getTime()+60000)}};}
async function mixedFixture(){
 const id=await owner(),time=new Date('2036-02-03T12:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:guard});let calls=0;
 const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async p=>{
  const current=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:{orderBy:{ordinal:'desc'}}}});
  assert.equal(current.status,'reserved');assert.ok(current.expiresAt!>time);assert.equal(current.attempts[0].status,'started');assert.equal(current.attempts[0].model,p.model);
  if(++calls===1)throw new AppError('ambiguous provider unavailable',503,'MODEL_UNAVAILABLE');
  return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:env.usageTokensPerCredit*2}};
 }});
 await chat.createChatReply(request,{userId:id});
 const row=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:{orderBy:{ordinal:'asc'}}}});
 return {id,time,repo,row,calls:()=>calls};
}

it('F1 refuses summary generation after a real PostgreSQL reservation failure and preserves saved chats',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:{...guard,creditLimit:1,requestLimit:1}}),pool=new Pool({connectionString:process.env.DATABASE_URL});let calls=0;
 const summaryRepo=createPrismaConversationSummaryRepository(),service=createConversationSummaryService({repository:summaryRepo});
 const refresh=createConversationSummaryRefreshService({repository:summaryRepo,service,usage:createConversationSummaryUsageService(usage),summarizer:{model:'gemini-3.1-flash-lite',provider:'gemini',async generate(){calls++;return {summary:'Synthetic summary',openQuestions:[],model:'gemini-3.1-flash-lite',provider:'gemini',usage:{totalTokens:2000}};}}});
 try{
  await pool.query(`CREATE FUNCTION partial_summary_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${id}' AND NEW."action"='conversation_summary' THEN RAISE EXCEPTION 'reservation SQL failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER partial_summary_fail BEFORE INSERT ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION partial_summary_fail()');
  const results=[];
  for(let n=0;n<3;n++){
   const chat=await prisma.chat.create({data:{userId:id,title:'Reserved summary '+n}});
   await prisma.message.createMany({data:Array.from({length:12},(_,i)=>({id:randomUUID(),chatId:chat.id,role:i%2?'ASSISTANT':'USER',content:i%2?'Answer':'Question',mode:'general',createdAt:new Date(time.getTime()+i)}))});
   results.push(await refresh.requestRefresh(id,chat.id));
  }
  console.log('F1_RESERVATION_PROOF',JSON.stringify({calls,results,events:await prisma.usageEvent.count({where:{userId:id}})}));
  assert.equal(calls,0,'No provider may run without a committed reservation');
  assert.deepEqual(results,['failed','failed','failed']);
  assert.equal(await prisma.conversationSummary.count({where:{userId:id}}),0);
  assert.equal(await prisma.chat.count({where:{userId:id}}),3);
  assert.equal(await prisma.message.count({where:{chat:{userId:id}}}),36);
 }finally{await pool.query('DROP TRIGGER IF EXISTS partial_summary_fail ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS partial_summary_fail()');await pool.end();}
});

it('F2 keeps a failed generation estimate separate from a confirmed fallback receipt',async()=>{
 const id=await owner(),time=new Date('2036-02-03T12:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:guard});let calls=0;
 const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async p=>{if(++calls===1)throw new AppError('ambiguous provider unavailable',503,'MODEL_UNAVAILABLE');return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:env.usageTokensPerCredit*2}};}});
 const response=await chat.createChatReply(request,{userId:id});
 const row=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:{orderBy:{ordinal:'asc'}}}}),accounting=await repo.readUsageAccounting!(row.id);
 console.log('F2_PARTIAL_PROOF',JSON.stringify({calls,eventStatus:row.status,creditsUsed:row.creditsUsed,units:row.units,accounting,responseUsage:response.usage}));
 assert.equal(row.attempts[0].status,'unknown');assert.equal(row.attempts[0].creditsUsed,null);
 assert.equal(row.units,3,'Unknown estimate remains in the quota');
 assert.equal(row.creditsUsed,2,'Only the confirmed receipt is a verified debit');
 assert.equal(row.status,'partial');assert.equal(accounting.status,'unconfirmed');assert.equal(response.usage?.accountingStatus,'unconfirmed');
 assert.equal(calls,2);
 await repo.reconcileExpiredUsage!({strict:true});
 assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:row.id}})).status,'partial');
 await assert.rejects(repo.beginUsageAttempt!(row.id),{code:'AI_RESERVATION_EXPIRED'});
});

it('F1 does not call the summary provider when PostgreSQL rejects attempt registration',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time}),pool=new Pool({connectionString:process.env.DATABASE_URL});let calls=0;
 const summaryRepo=createPrismaConversationSummaryRepository(),service=createConversationSummaryService({repository:summaryRepo});
 const refresh=createConversationSummaryRefreshService({repository:summaryRepo,service,usage:createConversationSummaryUsageService(usage),summarizer:{model:'gemini-3.1-flash-lite',provider:'gemini',async generate(){
  const record=await prisma.usageEvent.findFirstOrThrow({where:{userId:id,status:'reserved'},include:{attempts:true}});
  assert.equal(record.attempts.length,1);assert.equal(record.attempts[0].status,'started');assert.ok(record.expiresAt!>time);
  calls++;return {summary:'Summary after valid reservation',openQuestions:[],model:'gemini-3.1-flash-lite',provider:'gemini',usage:{totalTokens:2000}};
 }}});
 const chat=await prisma.chat.create({data:{userId:id,title:'Attempt admission'}});
 await prisma.message.createMany({data:Array.from({length:12},(_,i)=>({chatId:chat.id,role:i%2?'ASSISTANT':'USER',content:'Saved turn',createdAt:new Date(time.getTime()+i)}))});
 try{
  await pool.query(`CREATE FUNCTION partial_begin_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'attempt registration unavailable'; END $$`);
  await pool.query('CREATE TRIGGER partial_begin_fail BEFORE INSERT ON "UsageProviderAttempt" FOR EACH ROW EXECUTE FUNCTION partial_begin_fail()');
  assert.equal(await refresh.requestRefresh(id,chat.id),'failed');assert.equal(calls,0);
  const failed=await prisma.usageEvent.findFirstOrThrow({where:{userId:id}});assert.equal(failed.units,0);assert.equal(failed.status,'failed');
  assert.equal(await prisma.message.count({where:{chatId:chat.id}}),12);
  await pool.query('DROP TRIGGER partial_begin_fail ON "UsageProviderAttempt"');
  assert.equal(await refresh.requestRefresh(id,chat.id),'completed');assert.equal(calls,1);
 }finally{await pool.query('DROP TRIGGER IF EXISTS partial_begin_fail ON "UsageProviderAttempt"');await pool.query('DROP FUNCTION IF EXISTS partial_begin_fail()');await pool.end();}
});

it('applies late evidence to its original attempt once, without another provider call or guessed debit',async()=>{
 const {repo,row,calls}=await mixedFixture(),first=row.attempts[0];
 const evidence={id:row.id,attemptId:first.id,status:'completed',totalTokens:env.usageTokensPerCredit*4};
 await Promise.all(Array.from({length:8},()=>repo.updateUsage(evidence)));
 await Promise.all([repo.reconcileExpiredUsage!({strict:true}),repo.updateUsage({id:row.id,status:'failed',units:0})]);
 const settled=await prisma.usageEvent.findUniqueOrThrow({where:{id:row.id},include:{attempts:{orderBy:{ordinal:'asc'}},settlementReceipts:true}});
 assert.equal(settled.status,'completed');assert.equal(settled.units,6);assert.equal(settled.creditsUsed,6);assert.equal(settled.totalTokens,env.usageTokensPerCredit*6);
 assert.deepEqual(settled.attempts.map(a=>a.creditsUsed),[4,2]);assert.equal(settled.settlementReceipts.length,2);assert.ok(settled.settlementReceipts.every(r=>r.appliedAt));
 assert.equal((await repo.readUsageAccounting!(row.id)).status,'settled');assert.equal(calls(),2);
 await assert.rejects(repo.updateUsage({...evidence,totalTokens:100}),{code:'AI_USAGE_RECEIPT_CONFLICT'});
 await assert.rejects(repo.beginUsageAttempt!(row.id),{code:'AI_RESERVATION_EXPIRED'});
 console.log('LATE_ATTEMPT_EVIDENCE_PROOF',JSON.stringify({providerCalls:calls(),receipts:settled.settlementReceipts.length,confirmed:settled.creditsUsed,quota:settled.units}));
});

it('keeps partial consumption intact if the late receipt cannot be captured',async()=>{
 const {repo,row,calls}=await mixedFixture(),pool=new Pool({connectionString:process.env.DATABASE_URL}),first=row.attempts[0];
 try{
  await pool.query(`CREATE FUNCTION partial_capture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."attemptId"='${first.id}' THEN RAISE EXCEPTION 'late receipt capture unavailable'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER partial_capture_fail BEFORE INSERT ON "UsageSettlementReceipt" FOR EACH ROW EXECUTE FUNCTION partial_capture_fail()');
  await assert.rejects(repo.updateUsage({id:row.id,attemptId:first.id,status:'completed',totalTokens:env.usageTokensPerCredit*4}),{code:'AI_USAGE_ACCOUNTING_UNAVAILABLE'});
  const partial=await prisma.usageEvent.findUniqueOrThrow({where:{id:row.id}});
  assert.equal(partial.status,'partial');assert.equal(partial.units,3);assert.equal(partial.creditsUsed,2);assert.equal(calls(),2);
  assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:row.id}}),1);
 }finally{await pool.query('DROP TRIGGER IF EXISTS partial_capture_fail ON "UsageSettlementReceipt"');await pool.query('DROP FUNCTION IF EXISTS partial_capture_fail()');await pool.end();}
});

it('recovers an older attempt receipt after SQL settlement failure and repository restart',async()=>{
 const {repo,row,time,calls}=await mixedFixture(),pool=new Pool({connectionString:process.env.DATABASE_URL}),first=row.attempts[0];
 try{
  await pool.query(`CREATE FUNCTION partial_apply_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id"='${row.id}' AND NEW."status"='completed' THEN RAISE EXCEPTION 'late receipt settlement unavailable'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER partial_apply_fail BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION partial_apply_fail()');
  await assert.rejects(repo.updateUsage({id:row.id,attemptId:first.id,status:'completed',totalTokens:env.usageTokensPerCredit*4}),{code:'AI_USAGE_SETTLEMENT_PENDING'});
  const pending=await repo.readUsageAccounting!(row.id);assert.equal(pending.status,'pending');assert.equal(pending.units,6);assert.equal(pending.confirmedUnits,6);
  assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:row.id,appliedAt:null}}),1);
  assert.equal(await repo.countUsage({action:'chat_message',userId:row.userId!,since:new Date(time.getTime()-3600000)}),6);
  await assert.rejects(repo.reconcileExpiredUsage!({strict:true}),{code:'AI_USAGE_RECOVERY_PENDING'});
  await pool.query('DROP TRIGGER partial_apply_fail ON "UsageEvent"');
  const restarted=createPrismaUsageRepository(prisma,()=>new Date(time.getTime()+1800001));
  await Promise.all(Array.from({length:8},()=>restarted.reconcileExpiredUsage!({strict:true})));
  const final=await prisma.usageEvent.findUniqueOrThrow({where:{id:row.id}});assert.equal(final.status,'completed');assert.equal(final.creditsUsed,6);assert.equal(final.units,6);assert.equal(calls(),2);
 }finally{await pool.query('DROP TRIGGER IF EXISTS partial_apply_fail ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS partial_apply_fail()');await pool.end();}
});

it('never substitutes a receipt for the wrong event and keeps multiple unknown outcomes partial',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),reservation=await repo.reserveUsage(reservationInput(id,time));
 for(let i=0;i<3;i++)await repo.beginUsageAttempt!(reservation.eventId!);
 await repo.updateUsage({id:reservation.eventId!,status:'completed',totalTokens:env.usageTokensPerCredit*2});
 const attempts=await prisma.usageProviderAttempt.findMany({where:{eventId:reservation.eventId},orderBy:{ordinal:'asc'}});
 await repo.updateUsage({id:reservation.eventId!,attemptId:attempts[0].id,status:'completed',totalTokens:env.usageTokensPerCredit*3});
 const partial=await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}});assert.equal(partial.status,'partial');assert.equal(partial.units,6);assert.equal(partial.creditsUsed,5);
 const other=await repo.reserveUsage(reservationInput(id,time));await repo.beginUsageAttempt!(other.eventId!);
 await assert.rejects(repo.updateUsage({id:other.eventId!,attemptId:attempts[1].id,status:'completed',creditsUsed:0}),{code:'AI_USAGE_ACCOUNTING_UNAVAILABLE'});
 assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:other.eventId}}),0);
 await repo.updateUsage({id:reservation.eventId!,attemptId:attempts[1].id,status:'completed',creditsUsed:0});
 const settled=await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}});assert.equal(settled.status,'completed');assert.equal(settled.units,5);assert.equal(settled.creditsUsed,5);
 assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:reservation.eventId}}),3);
});

it('retains unresolved mixed attempts during cleanup and permits retention after trusted reconciliation',async()=>{
 const {row}=await mixedFixture();const old=new Date('2001-01-01T00:00:00Z');
 await prisma.usageEvent.update({where:{id:row.id},data:{createdAt:old}});
 const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
 const retention=createPrismaRetentionRepository(prisma),cutoffs={authTokensBefore:new Date(0),unverifiedAccountsBefore:new Date(0),usageBefore:new Date('2010-01-01T00:00:00Z')};
 // The fixture's attempts are in 2036; use a cleanup clock beyond all their
 // quota windows so this still isolates unresolved-accounting protection.
 const outside=new Date(Math.max(...row.attempts.map(a=>a.startedAt.getTime()))+Math.max(32*86_400_000,env.aiGlobalUsageWindowMs)+1);
 await retention.purgeExpiredData(outside,cutoffs,100);
 assert.ok(await prisma.usageEvent.findUnique({where:{id:row.id}}));assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:row.id}}),1);
 await createPrismaUsageRepository(prisma,()=>outside).updateUsage({id:row.id,attemptId:row.attempts[0].id,status:'completed',totalTokens:100});
 await retention.purgeExpiredData(outside,cutoffs,100);
 assert.equal(await prisma.usageEvent.findUnique({where:{id:row.id}}),null);assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:row.id}}),0);
});

it('requires actual consumption values even when a caller declares usage confirmed',async()=>{
 const id=await owner();let time=new Date();const repo=createPrismaUsageRepository(prisma,()=>time),reservation=await repo.reserveUsage(reservationInput(id,time));
 await repo.beginUsageAttempt!(reservation.eventId!);
 await assert.rejects(repo.updateUsage({id:reservation.eventId!,status:'completed',usageConfirmed:true}),{code:'AI_USAGE_ACCOUNTING_UNAVAILABLE'});
 assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:reservation.eventId}}),0);
 time=new Date(time.getTime()+60001);await repo.reconcileExpiredUsage!({strict:true});
 const unresolved=await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}});
 assert.equal(unresolved.status,'unknown');assert.equal(unresolved.creditsUsed,null);assert.equal(unresolved.units,1);
});

it('rejects empty zero-token and malformed receipts while permitting explicit confirmed zero credits',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),reservation=await repo.reserveUsage(reservationInput(id,time));await repo.beginUsageAttempt!(reservation.eventId!);
 const invalid=[{totalTokens:0,promptTokens:0,outputTokens:0},{totalTokens:Number.NaN},{promptTokens:Infinity},{outputTokens:-1},{totalTokens:1.5},{creditsUsed:Number.NaN},{creditsUsed:-1},{creditsUsed:1.5},{creditsUsed:Infinity}];
 for(const consumption of invalid)await assert.rejects(repo.updateUsage({id:reservation.eventId!,status:'completed',usageConfirmed:true,...consumption}),{code:'AI_USAGE_ACCOUNTING_UNAVAILABLE'});
 assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:reservation.eventId}}),0);
 assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}})).status,'reserved');
 await repo.updateUsage({id:reservation.eventId!,status:'completed',usageConfirmed:true,creditsUsed:0});
 const zero=await prisma.usageEvent.findUniqueOrThrow({where:{id:reservation.eventId}});assert.equal(zero.status,'completed');assert.equal(zero.creditsUsed,0);assert.equal(zero.units,0);
});
