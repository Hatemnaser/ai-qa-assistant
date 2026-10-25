import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';

assertPostgresIntegrationTarget(process.env);
// Standalone: these configuration values must precede application imports.
const DAY=86_400_000,WINDOW=40*DAY;
Object.assign(process.env,{AI_GLOBAL_USAGE_WINDOW_MS:'3600000',USAGE_WINDOW_HOURS:'960',
 USAGE_RECORD_RETENTION_DAYS:'32',USER_DAILY_CREDITS:'1',GUEST_DAILY_CREDITS:'1',GEMINI_API_KEY:'',
 AI_GLOBAL_CREDIT_LIMIT:'1000',AI_GLOBAL_REQUEST_LIMIT:'1000',AI_GLOBAL_DAILY_CREDIT_LIMIT:'1000',
 AI_GLOBAL_DAILY_REQUEST_LIMIT:'1000',AI_GLOBAL_MONTHLY_CREDIT_LIMIT:'1000',AI_GLOBAL_MONTHLY_REQUEST_LIMIT:'1000'});
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {getUsageIdentityScope}=await import('../src/modules/usage/usage.scope.ts');
const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
const {createRetentionService,getConfiguredRetentionPolicy}=await import('../src/modules/retention/retention.service.ts');
const {createPrismaAccountRepository}=await import('../src/modules/account/account.repository.ts');
const {AI_USAGE_ACTIONS}=await import('../src/modules/usage/usage.types.ts');
const owners:string[]=[],events:string[]=[],guests:string[]=[],current=new Date('2039-08-15T12:00:00Z');
const policy=getConfiguredRetentionPolicy();
const input={message:'Quota fixture',history:[],mode:'general' as const,model:'gemini-3.1-flash-lite'};
async function owner(){const id='identity-retention-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:new Date()}});return id;}
function retention(){return createRetentionService(createPrismaRetentionRepository(prisma));}
function usage(time:Date){return createUsageService({repository:createPrismaUsageRepository(prisma,()=>time),now:()=>time});}
async function consumed(identity:{userId?:string;guestId?:string;ipHash?:string},time:Date,attemptAt=time,settled=true){
 let clock=time;const repo=createPrismaUsageRepository(prisma,()=>clock);
 const r=await repo.reserveUsage({action:'chat_message',...identity,isSignedIn:Boolean(identity.userId),limit:100,requestedUnits:1,since:new Date(time.getTime()-WINDOW),
  event:{...identity,action:'chat_message',status:'reserved',units:1,creditsReserved:1,estimatedTotalTokens:1000,model:'gemini-3.1-flash-lite',provider:'gemini',expiresAt:new Date(time.getTime()+60_000)}});
 assert.equal(r.accepted,true);events.push(r.eventId!);clock=attemptAt;await repo.beginUsageAttempt!(r.eventId!);
 await repo.updateUsage({id:r.eventId!,status:settled?'completed':'unknown',...(settled?{totalTokens:1000}:{})});return r.eventId!;
}
const next=(id:string,time:Date)=>usage(time).reserveAiOperation({action:'conversation_summary',credits:1,userId:id});
afterEach(async()=>{await prisma.usageEvent.deleteMany({where:{OR:[{id:{in:events.splice(0)}},{userId:{in:owners}},{guestId:{in:guests.splice(0)}}]}});await prisma.user.deleteMany({where:{id:{in:owners.splice(0)}}});});
after(()=>prisma.$disconnect());

it('I1 keeps actual user consumption after the global windows expire while its configured identity window remains active',async()=>{
 const id=await owner(),eventId=await consumed({userId:id},new Date(current.getTime()-33*DAY));
 await assert.rejects(next(id,current),{code:'USAGE_LIMIT_REACHED'});
 await retention().drain(current,policy,2,20);
 await assert.rejects(next(id,current),{code:'USAGE_LIMIT_REACHED'});
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId},include:{attempts:true,settlementReceipts:true}});
 assert.equal(row.creditsUsed,1);assert.equal(row.attempts.length,1);assert.equal(row.settlementReceipts.length,1);
});

it('I2 uses the last actual attempt and an inclusive identity boundary before releasing exactly one concurrent reservation',async()=>{
 const id=await owner(),first=new Date(current.getTime()-WINDOW-1000),attempt=new Date(first.getTime()+2000),eventId=await consumed({userId:id},first,attempt);
 const boundary=new Date(attempt.getTime()+WINDOW);await retention().purge(boundary,policy);
 await assert.rejects(next(id,boundary),{code:'USAGE_LIMIT_REACHED'});
 assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),1);
 const outside=new Date(boundary.getTime()+1);await retention().purge(outside,policy);
 assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),0);assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId}}),0);
 const results=await Promise.allSettled([next(id,outside),next(id,outside)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='USAGE_LIMIT_REACHED').length,1);
});

it('I3 keeps guest-ID and IP-hash limits independently after cleanup, without calling the provider',async()=>{
 const guestId='guest-'+randomUUID(),otherGuestId='other-'+randomUUID(),ipAddress='198.51.100.7',scope=getUsageIdentityScope({guestId,ipAddress});guests.push(guestId,otherGuestId);
 const eventId=await consumed({guestId,ipHash:scope.ipHash},new Date(current.getTime()-33*DAY));
 await retention().purge(current,policy);let calls=0;const service=usage(current);
 const chat=createChatService({reserveUsage:service.reserveChatCredits,recordUsageAttempt:service.recordAiOperationAttempt,completeUsage:service.completeChatCredits,failUsage:service.failChatCredits,
  chatWithAi:async()=>{calls++;throw new Error('An exhausted identity must never invoke the provider');}});
 await assert.rejects(chat.createChatReply(input,{guestId,ipAddress:'198.51.100.8'}),{code:'USAGE_LIMIT_REACHED'});
 await assert.rejects(chat.createChatReply(input,{guestId:otherGuestId,ipAddress}),{code:'USAGE_LIMIT_REACHED'});
 assert.equal(calls,0);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),1);
});

it('I4 protects legacy user charges for every AI action and guest-only/IP-only rows while draining unrelated rows',async()=>{
 const id=await owner(),recent=new Date(current.getTime()-33*DAY),guest='legacy-guest-'+randomUUID(),ip='legacy-ip-'+randomUUID();
 for(const action of AI_USAGE_ACTIONS){const e=await prisma.usageEvent.create({data:{userId:id,action,createdAt:recent,status:'completed',units:1,creditsUsed:1}});events.push(e.id);}
 for(const identity of [{guestId:guest},{ipHash:ip}]){const e=await prisma.usageEvent.create({data:{...identity,action:'chat_message',createdAt:recent,status:'completed',units:1}});events.push(e.id);}
 const unrelated=await prisma.usageEvent.create({data:{userId:id,action:'asset_upload',createdAt:recent,status:'completed',units:1}});events.push(unrelated.id);
 const noIdentity=await prisma.usageEvent.create({data:{action:'chat_message',createdAt:recent,status:'completed',units:1}});events.push(noIdentity.id);
 const result=await retention().drain(current,policy,2,20);assert.equal(result.usageEvents,2);assert.equal(result.stopReason,'drained');
 assert.equal(await prisma.usageEvent.count({where:{id:{in:events}}}),AI_USAGE_ACTIONS.length+2);
 await assert.rejects(next(id,current),{code:'USAGE_LIMIT_REACHED'});
 await retention().drain(new Date(recent.getTime()+WINDOW+1),policy,2,20);assert.equal(await prisma.usageEvent.count({where:{id:{in:events}}}),0);
});

it('I5 a long identity window does not extend deleted-account financial retention or restore private context',async()=>{
 const start=new Date();
 for(const settled of [true,false]){
  const id=await owner(),eventId=await consumed({userId:id,guestId:'private-guest',ipHash:'private-ip'},start,start,settled);
  await createPrismaAccountRepository(prisma).deleteAccountData(id);
  const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId},include:{attempts:true,settlementReceipts:true}});
  assert.equal(row.userId,null);assert.equal(row.guestId,null);assert.equal(row.ipHash,null);assert.ok(row.anonymousUntil);
  assert.ok(row.anonymousUntil!.getTime()<=start.getTime()+33*DAY,'Identity window must not lengthen ownerless retention');
  assert.doesNotMatch(JSON.stringify(row),new RegExp(id+'|private-guest|private-ip'));
  const before=new Date(row.anonymousUntil!.getTime()-1);await retention().purge(before,policy);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),1);
  await retention().purge(row.anonymousUntil!,policy);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),0);
  assert.equal(await prisma.usageProviderAttempt.count({where:{eventId}}),0);assert.equal(await prisma.user.count({where:{id}}),0);
 }
});

it('I6 automatic unverified-account cleanup removes its obsolete identity quota instead of keeping deleted personal data',async()=>{
 const time=new Date(),id=await owner(),eventId=await consumed({userId:id},new Date(time.getTime()-33*DAY));
 await prisma.user.update({where:{id},data:{emailVerifiedAt:null,createdAt:new Date(time.getTime()-50*DAY)}});
 const result=await retention().drain(time,policy,2,20);assert.equal(result.unverifiedAccounts,1);
 assert.equal(await prisma.user.count({where:{id}}),0);assert.equal(await prisma.usageEvent.count({where:{id:eventId}}),0);
});

it('I7 concurrent cleanup and duplicate settlement neither reopen a user quota nor double its confirmed debit',async()=>{
 const id=await owner(),eventId=await consumed({userId:id},new Date(current.getTime()-33*DAY)),repo=createPrismaUsageRepository(prisma,()=>current);
 const results=await Promise.allSettled([assert.rejects(next(id,current),{code:'USAGE_LIMIT_REACHED'}),...Array.from({length:3},()=>retention().purge(current,policy)),...Array.from({length:6},()=>repo.updateUsage({id:eventId,status:'completed',totalTokens:1000}))]);
 assert.deepEqual(results.filter(r=>r.status==='rejected'),[]);
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:eventId},include:{settlementReceipts:true,attempts:true}});
 assert.equal(row.creditsUsed,1);assert.equal(row.units,1);assert.equal(row.settlementReceipts.length,1);assert.equal(row.attempts.length,1);
 assert.equal(await prisma.usageEvent.count({where:{userId:id}}),1);
});

it('I8 reloads changed identity/global/retention settings in fresh processes without losing active history',async()=>{
 const id=await owner(),eventId=await consumed({userId:id},new Date(current.getTime()-33*DAY));
 for(const config of [
  {hours:960,days:32,globalDays:1/24,blocked:true,exists:true},
  {hours:1440,days:32,globalDays:1/24,blocked:true,exists:true},
  {hours:24,days:45,globalDays:1/24,blocked:false,exists:true},
  {hours:24,days:32,globalDays:40,blocked:false,exists:true},
  {hours:24,days:32,globalDays:1/24,blocked:false,exists:false},
 ]){
  const result=await processPass({time:current.toISOString(),owner:id,eventId},config);
  assert.equal(result.eventExists,config.exists);assert.equal(result.rejection,config.blocked?'USAGE_LIMIT_REACHED':null);assert.equal(result.providerCalls,0);
  if(result.newReservation)await prisma.usageEvent.delete({where:{id:result.newReservation}});
 }
});

async function processPass(input:object,config:{hours:number;days:number;globalDays:number}){
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/quota-retention-worker.mts',JSON.stringify(input)],{
  env:{...process.env,USAGE_WINDOW_HOURS:String(config.hours),USAGE_RECORD_RETENTION_DAYS:String(config.days),AI_GLOBAL_USAGE_WINDOW_MS:String(Math.round(config.globalDays*DAY))},
  stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let errors='';child.stderr!.on('data',data=>errors+=data);const exit=once(child,'exit');
 try{const [message]=await Promise.race([once(child,'message'),exit.then(()=>{throw new Error('Retention worker exited before proof: '+errors);})]);const [code]=await exit;assert.equal(code,0,errors);return message as {eventExists:boolean;rejection:string|null;newReservation?:string;providerCalls:number};}
 finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
}
