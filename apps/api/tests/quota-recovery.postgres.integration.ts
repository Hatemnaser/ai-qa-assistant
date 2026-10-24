import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {after,afterEach,describe,it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {AppError}=await import('../src/lib/errors.ts');
const {env}=await import('../src/config/env.ts');
const {createQaExecutionRepository,reapV2Executions}=await import('../src/modules/qa-requests/qa-execution.repository.ts');
const {createBrowserRuntimeRepository}=await import('../src/modules/browser-runtime/browser-runtime.repository.ts');
const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
const owners:string[]=[];
const guests:string[]=[];
async function owner(){const id='review-06b-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test'}});return id;}
function input(userId:string,time:Date,limit=100){return {action:'chat_message',isSignedIn:true,userId,limit,requestedUnits:3,since:new Date(time.getTime()-86400000),scopeActions:['chat_message'],inFlightLimit:3,event:{action:'chat_message',userId,model:'gemini-3.1-flash-lite',provider:'gemini',creditsReserved:3,estimatedTotalTokens:env.usageTokensPerCredit*3,status:'reserved',units:3,expiresAt:new Date(time.getTime()+1800000)}};}
afterEach(async()=>{const ids=owners.splice(0);await prisma.usageEvent.deleteMany({where:{OR:[{userId:{in:ids}},{guestId:{in:guests.splice(0)}}]}});await prisma.user.deleteMany({where:{id:{in:ids}}});});
after(()=>prisma.$disconnect());
async function killedWorker(payload:object){
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/quota-recovery-worker.mts',JSON.stringify(payload)],{env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 assert.ok(child.stderr);
 let error='';child.stderr.on('data',d=>error+=d);
 try{
  const message=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('worker exited: '+error)})]);
  assert.equal(message[0].ready,true);
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;return message[0];
 }finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');}
}
async function httpWorker(recover=false){
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/quota-recovery-worker.mts',JSON.stringify({operation:'http',time:new Date(),recover})],{env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 assert.ok(child.stderr);
 let providerCalls=0,errors='';child.stderr.on('data',data=>errors+=data);
 child.on('message',message=>{if((message as {providerCall?:boolean}).providerCall)providerCalls++;});
 const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}};
 try{
  const [ready]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('HTTP fixture exited: '+errors);})]);
  assert.equal(ready.ready,true);
  return {ready,calls:()=>providerCalls,stop};
 }catch(error){await stop();throw error;}
}
describe('06B quota and accounting recovery regressions',{concurrency:false},()=>{
 it('keeps a committed pre-call debit across abrupt process death and reconciles it from a new process connection',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const repo=createPrismaUsageRepository(prisma,()=>time);
  const r=await repo.reserveUsage(input(id,time));await killedWorker({operation:'begin',eventId:r.eventId,time});
  let row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
  assert.equal(row.attempts.length,1);assert.equal(row.units,3);assert.equal(row.attempts[0].status,'started');
  time=new Date(time.getTime()+1800001);await createPrismaUsageRepository(prisma,()=>time).reconcileExpiredUsage!();
  row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
  assert.equal(row.status,'unknown');assert.equal(row.units,3);assert.equal(row.attempts[0].status,'unknown');
 });
 it('rolls back an uncommitted attempt settlement after abrupt process death',async()=>{
  const id=await owner(),time=new Date('2035-01-15T12:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time);
  const r=await repo.reserveUsage(input(id,time));await repo.beginUsageAttempt!(r.eventId!);
  await killedWorker({operation:'settle',eventId:r.eventId,time});
  const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
  assert.equal(row.status,'reserved');assert.equal(row.units,3);assert.equal(row.attempts[0].status,'started');assert.equal(row.attempts[0].creditsUsed,null);
  await createPrismaUsageRepository(prisma,()=>time).updateUsage({id:r.eventId!,status:'completed',totalTokens:100});
  assert.equal(await repo.readUsageCharge!(r.eventId!),1);
 });
 it('rolls back the real finalizer atomically on PostgreSQL failure and settles once on explicit retry',async()=>{
  const id=await owner(),time=new Date('2035-01-15T12:00:00Z'),repo=createPrismaUsageRepository(prisma,()=>time);
  const r=await repo.reserveUsage(input(id,time));await repo.beginUsageAttempt!(r.eventId!);
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try{
   await pool.query(`CREATE FUNCTION review_fail_settle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id"='${r.eventId}' AND NEW."status"='completed' THEN RAISE EXCEPTION 'review settlement failure'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER review_fail_settle BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION review_fail_settle()');
   await assert.rejects(repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:100}));
   let row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
   assert.equal(row.status,'settlement_pending');assert.equal(row.units,1);assert.equal(row.attempts[0].status,'started');assert.equal(row.attempts[0].creditsUsed,null);
   await assert.rejects(repo.beginUsageAttempt!(r.eventId!),{code:'AI_RESERVATION_EXPIRED'});
   await assert.rejects(repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:env.usageTokensPerCredit*2}),{code:'AI_USAGE_RECEIPT_CONFLICT'});
   await pool.query('DROP TRIGGER review_fail_settle ON "UsageEvent"');await pool.query('DROP FUNCTION review_fail_settle()');
   await Promise.all([repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:100}),repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:100})]);
   row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
   assert.equal(row.units,1);assert.equal(row.attempts.length,1);assert.equal(row.attempts[0].creditsUsed,1);
  }finally{await pool.query('DROP TRIGGER IF EXISTS review_fail_settle ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS review_fail_settle()');await pool.end();}
 });
 it('keeps fallback calls inside their actual rolling request and credit window',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const start=time.getTime();
  const repo=createPrismaUsageRepository(prisma,()=>time);
  const service=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:{creditLimit:1,dailyCreditLimit:10000,monthlyCreditLimit:10000,requestLimit:1,dailyRequestLimit:1000,monthlyRequestLimit:1000,windowMs:60000}});
  const calls:Array<{at:number,model:string}>=[];
  const chat=createChatService({reserveUsage:service.reserveChatCredits,recordUsageAttempt:service.recordAiOperationAttempt,completeUsage:service.completeChatCredits,failUsage:service.failChatCredits,chatWithAi:async p=>{
   calls.push({at:time.getTime(),model:p.model!});
   if(calls.length===1){time=new Date(start+60001);throw new AppError('synthetic delayed unavailable',503,'MODEL_UNAVAILABLE');}
   return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:100}};
  }});
  await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'auto'},{userId:id});
  await assert.rejects(()=>chat.createChatReply({message:'Hello again',history:[],mode:'general',model:'gemini-3.1-flash-lite'},{userId:id}),{code:'AI_USAGE_LIMIT_REACHED'});
  const recent=calls.filter(call=>call.at>start);
  assert.equal(recent.length,1,'Only one provider call fits in this window');
  const events=await prisma.usageEvent.findMany({where:{userId:id},include:{attempts:true}});
  console.log('ROLLING_WINDOW_QUOTA_PROOF',JSON.stringify({requestLimit:1,windowMs:60000,calls,events:events.map(e=>({createdAt:e.createdAt,units:e.units,attempts:e.attempts.map(a=>({startedAt:a.startedAt,credits:a.creditsUsed}))}))}));
 });
 for(const budget of ['credits','requests'])it('enforces the default one-hour '+budget+' window by attempt time during concurrent admission',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const start=time.getTime(),windowMs=3600000;
  const repo=createPrismaUsageRepository(prisma,()=>time),service=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:{creditLimit:budget==='credits'?2:100,dailyCreditLimit:10000,monthlyCreditLimit:10000,requestLimit:budget==='requests'?2:100,dailyRequestLimit:1000,monthlyRequestLimit:1000,windowMs}});
  const calls:number[]=[];
  const chat=createChatService({reserveUsage:service.reserveChatCredits,recordUsageAttempt:service.recordAiOperationAttempt,completeUsage:service.completeChatCredits,failUsage:service.failChatCredits,chatWithAi:async p=>{
   calls.push(time.getTime());if(calls.length===1){time=new Date(start+1000);throw new AppError('synthetic unavailable',503,'MODEL_UNAVAILABLE');}
   return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:100}};
  }});
  await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'auto'},{userId:id});
  time=new Date(start+windowMs+500);
  const admitted=await Promise.allSettled([0,1].map(()=>chat.createChatReply({message:'Hello',history:[],mode:'general',model:'gemini-3.1-flash-lite'},{userId:id})));
  assert.equal(admitted.filter(row=>row.status==='fulfilled').length,1);
  assert.ok(admitted.some(row=>row.status==='rejected'&&row.reason.code==='AI_USAGE_LIMIT_REACHED'));
  const recent=calls.filter(at=>at>=time.getTime()-windowMs);
  assert.equal(recent.length,2,'The actual one-hour window must respect the two-call budget');
  console.log('DEFAULT_WINDOW_QUOTA_PROOF',JSON.stringify({windowMs,budget,calls,recentCalls:recent.length}));
 });
 it('preserves the global credit bound under twelve concurrent initial reservations',async()=>{
  const ids=await Promise.all(Array.from({length:12},()=>owner())),time=new Date('2035-01-15T12:00:00Z');
  const results=await Promise.all(ids.map(id=>{const spec=input(id,time);return createPrismaUsageRepository(prisma,()=>time).reserveUsage({...spec,globalGuard:{creditLimit:9,requestLimit:100,since:new Date(time.getTime()-3600000),staleReservedCutoff:new Date(time.getTime()-1800000)}});}));
  assert.equal(results.filter(r=>r.accepted).length,3);
  assert.equal((await prisma.usageEvent.aggregate({where:{userId:{in:ids}},_sum:{units:true}}))._sum.units,9);
 });
 it('serializes expiry reconciliation against a successful late receipt',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const repo=createPrismaUsageRepository(prisma,()=>time);
  const r=await repo.reserveUsage(input(id,time));await repo.beginUsageAttempt!(r.eventId!);time=new Date(time.getTime()+1800001);
  await Promise.all([repo.reconcileExpiredUsage!(),repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:100})]);
  const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});
  assert.equal(row.status,'completed');assert.equal(row.units,1);assert.equal(row.attempts[0].status,'completed');
 });
 it('retains browser capacity across process death and releases it only after Stop confirmation',async()=>{
  const id=await owner(),other=await owner();let time=new Date();
  const a=await quotaBrowserFixture(prisma,id,time),b=await quotaBrowserFixture(prisma,other,time);
  const executor=createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true});
  const job=await executor.start(a.start);time=new Date(time.getTime()+1);const second=await executor.start(b.start);
  await prisma.qaExecutionJob.updateMany({where:{id:{in:[job.executionId,second.executionId]}},data:{availableAt:time}});
  const runtimeId=randomUUID();await killedWorker({operation:'browser',time,executionId:job.executionId,connectionId:a.connection.id,claim:a.claim,runtimeId});
  assert.equal(await executor.claim(b.claim),null);
  time=new Date(time.getTime()+46000);await reapV2Executions(prisma,()=>time);
  const fresh=createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true}),claim={...b.claim,leaseExpiresAt:new Date(time.getTime()+45000)};
  assert.equal(await fresh.claim(claim),null);
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:job.executionId}})).state,'ACTIVE');
  const runtime=createBrowserRuntimeRepository(prisma,()=>time);
  await runtime.exit(a.connection.id,job.executionId,{runtimeId,observedAt:time.toISOString(),processExited:true});
  assert.ok(await fresh.claim(claim));
 });
 it('recovers a known token receipt after one transient settlement failure',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');
  const repo=createPrismaUsageRepository(prisma,()=>time),service=createUsageService({repository:repo,now:()=>time});
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const actualTokens=env.usageTokensPerCredit*2;
  try{
   await pool.query('CREATE SEQUENCE review_settlement_attempts');
   await pool.query(`CREATE FUNCTION review_drop_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${id}' AND NEW."status"='completed' AND nextval('review_settlement_attempts')=1 THEN RAISE EXCEPTION 'one transient settlement outage'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER review_drop_receipt BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION review_drop_receipt()');
   const chat=createChatService({reserveUsage:service.reserveChatCredits,recordUsageAttempt:service.recordAiOperationAttempt,completeUsage:service.completeChatCredits,failUsage:service.failChatCredits,chatWithAi:async p=>({reply:'successful answer',model:p.model!,provider:p.provider,usage:{totalTokens:actualTokens}})});
   const response=await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'gemini-3.1-flash-lite'},{userId:id});
   await pool.query('DROP TRIGGER review_drop_receipt ON "UsageEvent"');await pool.query('DROP FUNCTION review_drop_receipt()');
   assert.equal(response.reply,'successful answer');time=new Date(time.getTime()+1800001);
   await createPrismaUsageRepository(prisma,()=>time).reconcileExpiredUsage!();
   const row=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:true}});
   assert.equal(row.units,2);assert.equal(row.status,'completed');assert.equal(row.attempts[0].totalTokens,actualTokens);
   const settlementAttempts=(await pool.query('SELECT last_value::int FROM review_settlement_attempts')).rows[0].last_value;
   assert.ok(settlementAttempts>=2);
   console.log('RECEIPT_RECOVERY_PROOF',JSON.stringify({actualTokens,actualCredits:2,chargedCredits:row.units,returnedUsage:response.usage,status:row.status,persistedTotalTokens:row.attempts[0].totalTokens,settlementAttempts}));
  }finally{await pool.query('DROP TRIGGER IF EXISTS review_drop_receipt ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS review_drop_receipt()');await pool.query('DROP SEQUENCE IF EXISTS review_settlement_attempts');await pool.end();}
 });
 it('recovers a durable receipt after killing and restarting the real HTTP app without another SDK call',async()=>{
  const guest='receipt-http-'+randomUUID();guests.push(guest);
  const pool=new Pool({connectionString:process.env.DATABASE_URL});let first:Awaited<ReturnType<typeof httpWorker>>|undefined,second:Awaited<ReturnType<typeof httpWorker>>|undefined;
  try{
   await pool.query(`CREATE FUNCTION recovery_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."guestId"='${guest}' AND NEW."status"='completed' THEN RAISE EXCEPTION 'settlement remains offline'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER recovery_http_fail BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION recovery_http_fail()');
   first=await httpWorker();const r=first.ready;
   const response=await fetch(`http://127.0.0.1:${r.port}/api/chat`,{method:'POST',headers:{'content-type':'application/json',cookie:`qa_guest_id=${guest}; ${r.csrfCookie}=${r.csrf}`,[r.csrfHeader]:r.csrf},body:JSON.stringify({message:'Hello',history:[],mode:'general',model:'gemini-3.1-flash-lite'})});
   const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.usage.used,2);assert.equal(body.usage.accountingStatus,'pending');assert.equal(first.calls(),1);
   const pending=await prisma.usageEvent.findFirstOrThrow({where:{guestId:guest},include:{settlementReceipts:true,attempts:true}});
   assert.equal(pending.units,2);assert.equal(pending.status,'settlement_pending');assert.equal(pending.creditsUsed,null);assert.equal(pending.settlementReceipts.length,1);assert.equal(pending.settlementReceipts[0]?.credits,2);assert.equal(pending.settlementReceipts[0]?.appliedAt,null);
   // Pending known consumption already protects the budget, before event settlement.
   const beforeRecovery=createPrismaUsageRepository(prisma),time=new Date(),spec=input(await owner(),time);
   const used=await beforeRecovery.countUsage({action:'chat_message',guestId:guest,since:new Date(time.getTime()-3600000)});assert.equal(used,2);
   await assert.rejects(beforeRecovery.reconcileExpiredUsage!({strict:true}),{code:'AI_USAGE_RECOVERY_PENDING'});
   const guarded={...spec,requestedUnits:1,event:{...spec.event,units:1,creditsReserved:1},globalGuard:{creditLimit:2,requestLimit:100,since:new Date(time.getTime()-3600000),staleReservedCutoff:new Date(time.getTime()-1800000)}};
   assert.equal((await beforeRecovery.reserveUsage(guarded)).accepted,false);
   await first.stop();
   await pool.query('DROP TRIGGER recovery_http_fail ON "UsageEvent"');await pool.query('DROP FUNCTION recovery_http_fail()');
   second=await httpWorker(true);
   assert.equal((await fetch(`http://127.0.0.1:${second.ready.port}/`)).status,200);
   const recovered=await prisma.usageEvent.findUniqueOrThrow({where:{id:pending.id},include:{settlementReceipts:true,attempts:true}});
   assert.equal(recovered.units,2);assert.equal(recovered.creditsUsed,2);assert.equal(recovered.status,'completed');assert.equal(recovered.attempts[0].totalTokens,2000);assert.ok(recovered.settlementReceipts[0]?.appliedAt);assert.equal(second.calls(),0);
   await Promise.all(Array.from({length:5},()=>createPrismaUsageRepository(prisma).reconcileExpiredUsage!()));
   await beforeRecovery.updateUsage({id:pending.id,status:'failed',units:0});
   assert.equal(await beforeRecovery.readUsageCharge!(pending.id),2);
   assert.equal(await prisma.usageProviderAttempt.count({where:{eventId:pending.id}}),1);
   console.log('HTTP_RESTART_RECEIPT_PROOF',JSON.stringify({eventId:pending.id,providerCallsBeforeKill:first.calls(),providerCallsAfterRestart:second.calls(),actualCredits:2,recoveredCredits:recovered.units}));
  }finally{await first?.stop();await second?.stop();await pool.query('DROP TRIGGER IF EXISTS recovery_http_fail ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS recovery_http_fail()');await pool.end();}
 });
 it('keeps a failed receipt capture explicitly unconfirmed and never retries the provider',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time}),pool=new Pool({connectionString:process.env.DATABASE_URL});let calls=0;
  try{
   await pool.query('CREATE FUNCTION recovery_capture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'receipt database unavailable\'; END $$');
   await pool.query('CREATE TRIGGER recovery_capture_fail BEFORE INSERT ON "UsageSettlementReceipt" FOR EACH ROW EXECUTE FUNCTION recovery_capture_fail()');
   const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async p=>{calls++;return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:env.usageTokensPerCredit*2}};}});
   await assert.rejects(()=>chat.createChatReply({message:'Hello',history:[],mode:'general',model:'auto'},{userId:id}),{code:'AI_USAGE_ACCOUNTING_UNAVAILABLE'});
   assert.equal(calls,1);time=new Date(time.getTime()+1800001);
   await repo.reconcileExpiredUsage!();
   const event=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{attempts:true,settlementReceipts:true}});
   assert.equal(event.status,'unknown');assert.equal(event.creditsUsed,null);assert.deepEqual(event.settlementReceipts,[]);assert.equal(event.attempts[0].creditsUsed,null);
   assert.equal((await repo.readUsageAccounting!(event.id)).status,'unconfirmed');
  }finally{await pool.query('DROP TRIGGER IF EXISTS recovery_capture_fail ON "UsageSettlementReceipt"');await pool.query('DROP FUNCTION IF EXISTS recovery_capture_fail()');await pool.end();}
 });
 it('recovers a committed receipt after PostgreSQL terminates the connection during settlement',async()=>{
  const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time}),pool=new Pool({connectionString:process.env.DATABASE_URL});let calls=0;
  try{
   await pool.query('CREATE SEQUENCE recovery_connection_attempts');
   await pool.query(`CREATE FUNCTION recovery_connection_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${id}' AND NEW."status"='completed' AND nextval('recovery_connection_attempts')=1 THEN PERFORM pg_terminate_backend(pg_backend_pid()); END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER recovery_connection_fail BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION recovery_connection_fail()');
   const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async p=>{calls++;return {reply:'ok',model:p.model!,provider:p.provider,usage:{totalTokens:env.usageTokensPerCredit*2}};}});
   const response=await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'auto'},{userId:id});
   const event=await prisma.usageEvent.findFirstOrThrow({where:{userId:id},include:{settlementReceipts:true}});
   assert.equal(response.usage?.used,2);assert.equal(calls,1);assert.equal(event.status,'completed');assert.equal(event.creditsUsed,2);assert.ok(event.settlementReceipts[0]?.appliedAt);
   assert.ok((await pool.query('SELECT last_value::int FROM recovery_connection_attempts')).rows[0].last_value>=2);
  }finally{await pool.query('DROP TRIGGER IF EXISTS recovery_connection_fail ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS recovery_connection_fail()');await pool.query('DROP SEQUENCE IF EXISTS recovery_connection_attempts');await pool.end();}
 });
 it('retains an estimate as unconfirmed when the provider returns no usage receipt',async()=>{
  const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time});
  const chat=createChatService({reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits,chatWithAi:async p=>({reply:'ok',model:p.model!,provider:p.provider})});
  const response=await chat.createChatReply({message:'Hello',history:[],mode:'general',model:'gemini-3.1-flash-lite'},{userId:id});
  assert.equal(response.usage?.accountingStatus,'unconfirmed');
  const event=await prisma.usageEvent.findFirstOrThrow({where:{userId:id}});assert.equal(event.status,'unknown');assert.equal(event.creditsUsed,null);
 });
 it('keeps an aged uncalled hold in the budget and transfers its credits and fixed fee exactly once',async()=>{
  const id=await owner();let time=new Date('2035-01-15T12:00:00Z');const repo=createPrismaUsageRepository(prisma,()=>time),spec=input(id,time);
  const guarded={...spec,event:{...spec.event,fixedCredits:1,estimatedTotalTokens:100},globalGuard:{creditLimit:3,requestLimit:1,since:new Date(time.getTime()-60000),staleReservedCutoff:new Date(time.getTime()-1800000)}};
  const held=await repo.reserveUsage(guarded);time=new Date(time.getTime()+60001);
  const next={...input(id,time),requestedUnits:1,event:{...input(id,time).event,units:1,creditsReserved:1},globalGuard:{...guarded.globalGuard,since:new Date(time.getTime()-60000)}};
  assert.equal((await repo.reserveUsage(next)).accepted,false);
  await repo.beginUsageAttempt!(held.eventId!);
  assert.equal(await repo.countUsage({action:'chat_message',userId:id,since:new Date(time.getTime()-60000)}),3);
  await repo.updateUsage({id:held.eventId!,status:'completed',totalTokens:100});
  assert.equal(await repo.countUsage({action:'chat_message',userId:id,since:new Date(time.getTime()-60000)}),2);
  assert.equal((await repo.reserveUsage({...next,globalGuard:{...next.globalGuard,requestLimit:2}})).accepted,true);
 });
 it('releases a claimed reservation after process death when no runtime ever registered',async()=>{
  const aId=await owner(),bId=await owner();let time=new Date();const a=await quotaBrowserFixture(prisma,aId,time),b=await quotaBrowserFixture(prisma,bId,time);
  const executor=createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true});
  const aJob=await executor.start(a.start);time=new Date(time.getTime()+1);const bJob=await executor.start(b.start);
  await prisma.qaExecutionJob.updateMany({where:{id:{in:[aJob.executionId,bJob.executionId]}},data:{availableAt:time}});
  await killedWorker({operation:'claimOnly',time,executionId:aJob.executionId,claim:a.claim});
  time=new Date(time.getTime()+46000);await reapV2Executions(prisma,()=>time);
  assert.equal(await prisma.qaBrowserRuntime.count({where:{executionId:aJob.executionId}}),0);
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:aJob.executionId}})).state,'RELEASED');
  assert.ok(await createQaExecutionRepository(prisma,()=>time,{allowV2:true,requireRuntime:true}).claim({...b.claim,leaseExpiresAt:new Date(time.getTime()+45000)}));
 });
 it('retains pending receipts and active holds, then purges settled usage only outside its quota windows',async()=>{
  const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),pool=new Pool({connectionString:process.env.DATABASE_URL});
  const reservation=await repo.reserveUsage(input(id,time));await repo.beginUsageAttempt!(reservation.eventId!);
  try{
   await pool.query(`CREATE FUNCTION retention_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id"='${reservation.eventId}' AND NEW."status"='completed' THEN RAISE EXCEPTION 'pending during retention'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER retention_receipt_fail BEFORE UPDATE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION retention_receipt_fail()');
   await assert.rejects(repo.updateUsage({id:reservation.eventId!,status:'completed',totalTokens:100}));
   const uncalled=await repo.reserveUsage(input(id,time));
   const old=new Date('2001-01-01T00:00:00Z');
   await prisma.user.update({where:{id},data:{createdAt:old}});
   await prisma.usageEvent.updateMany({where:{id:{in:[reservation.eventId!,uncalled.eventId!]}},data:{createdAt:old}});
   const legacy=await prisma.usageEvent.create({data:{userId:id,action:'chat_message',status:'completed',units:1,createdAt:old}});
   const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
   const retention=createPrismaRetentionRepository(prisma),cutoffs={authTokensBefore:new Date(0),unverifiedAccountsBefore:new Date('2010-01-01T00:00:00Z'),usageBefore:new Date('2010-01-01T00:00:00Z')};
   await retention.purgeExpiredData(time,cutoffs,100);
   assert.equal(await prisma.usageEvent.findUnique({where:{id:legacy.id}}),null);
   assert.ok(await prisma.usageSettlementReceipt.findFirst({where:{eventId:reservation.eventId}}));
   assert.ok(await prisma.user.findUnique({where:{id}}));
   assert.ok(await prisma.usageEvent.findUnique({where:{id:uncalled.eventId}}));
   await pool.query('DROP TRIGGER retention_receipt_fail ON "UsageEvent"');await pool.query('DROP FUNCTION retention_receipt_fail()');
   await repo.reconcileExpiredUsage!({strict:true});
   await retention.purgeExpiredData(time,cutoffs,100);
   // The old parent timestamp does not age its recent provider attempt.
   assert.ok(await prisma.usageEvent.findUnique({where:{id:reservation.eventId}}));
   assert.ok(await prisma.usageSettlementReceipt.findFirst({where:{eventId:reservation.eventId}}));
   const outside=new Date(time.getTime()+Math.max(32*86_400_000,env.aiGlobalUsageWindowMs)+1);
   await retention.purgeExpiredData(outside,cutoffs,100);
   assert.equal(await prisma.usageEvent.findUnique({where:{id:reservation.eventId}}),null);
   assert.equal(await prisma.usageSettlementReceipt.findFirst({where:{eventId:reservation.eventId}}),null);
  }finally{await pool.query('DROP TRIGGER IF EXISTS retention_receipt_fail ON "UsageEvent"');await pool.query('DROP FUNCTION IF EXISTS retention_receipt_fail()');await pool.end();}
 });
});

