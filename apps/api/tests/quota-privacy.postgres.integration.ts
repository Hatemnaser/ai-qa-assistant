import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createPrismaAccountRepository}=await import('../src/modules/account/account.repository.ts');
const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
const {aggregateQuotaUsage}=await import('../src/modules/usage/usage-quota.ts');
const owners:string[]=[],events:string[]=[];
async function owner(){const id='privacy-final-'+randomUUID();owners.push(id);await prisma.user.create({data:{id,email:id+'@example.test',emailVerifiedAt:new Date()}});return id;}
function spec(id:string,time:Date){return {action:'chat_message',isSignedIn:true,userId:id,limit:100,requestedUnits:1,since:new Date(time.getTime()-86400000),event:{action:'chat_message',userId:id,guestId:'private-guest',ipHash:'private-ip',mode:'private-mode',model:'gemini-3.1-flash-lite',provider:'gemini',status:'reserved',units:1,creditsReserved:1,estimatedTotalTokens:100,expiresAt:new Date(time.getTime()+60000)}};}
afterEach(async()=>{await prisma.usageEvent.deleteMany({where:{OR:[{id:{in:events.splice(0)}},{userId:{in:owners}}]}});await prisma.user.deleteMany({where:{id:{in:owners.splice(0)}}});});
after(()=>prisma.$disconnect());

it('preserves finite global exposure while scrubbing all owner/context fields and late receipt payloads',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),r=await repo.reserveUsage(spec(id,time));events.push(r.eventId!);
 await repo.beginUsageAttempt!(r.eventId!);await repo.beginUsageAttempt!(r.eventId!);
 const attempts=await prisma.usageProviderAttempt.findMany({where:{eventId:r.eventId},orderBy:{ordinal:'asc'}});
 await repo.updateUsage({id:r.eventId!,attemptId:attempts[1].id,status:'completed',totalTokens:2000,workflowIntent:'private-context'});
 await createPrismaAccountRepository(prisma).deleteAccountData(id);
 let row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{settlementReceipts:true}});
 assert.equal(await prisma.user.count({where:{id}}),0);assert.equal(row.userId,null);assert.equal(row.guestId,null);assert.equal(row.ipHash,null);assert.equal(row.mode,null);assert.equal(row.workflowIntent,null);
 assert.deepEqual(row.reservationPolicy,{anonymized:true});assert.equal(row.units,3);assert.equal(row.creditsUsed,2);assert.equal(row.status,'partial');
 assert.ok(row.anonymousUntil!>time);assert.ok(row.anonymousUntil!.getTime()<=time.getTime()+33*86400000);
 const retainedUntil=row.anonymousUntil!.getTime();
 assert.doesNotMatch(JSON.stringify(row),new RegExp(id+'|private-context|private-guest|private-ip|private-mode'));
 await assert.rejects(repo.beginUsageAttempt!(row.id),{code:'AI_RESERVATION_EXPIRED'});
 await Promise.all(Array.from({length:6},()=>repo.updateUsage({id:row.id,attemptId:attempts[0].id,status:'completed',totalTokens:4000,workflowIntent:'private-late-context'})));
 row=await prisma.usageEvent.findUniqueOrThrow({where:{id:row.id},include:{settlementReceipts:true}});
 assert.equal(row.units,6);assert.equal(row.creditsUsed,6);assert.equal(row.settlementReceipts.length,2);assert.equal(row.anonymousUntil!.getTime(),retainedUntil);
 assert.equal(row.workflowIntent,null);assert.doesNotMatch(JSON.stringify(row),new RegExp(id+'|private-'));
 const count=await aggregateQuotaUsage(prisma,{actions:['chat_message'],since:new Date(time.getTime()-3600000)});assert.equal(count.unitsUsed,6);assert.equal(count.requestCount,2);
});

it('releases only an uncalled deleted-account hold on expiry and never authorizes its old reservation again',async()=>{
 const id=await owner();let time=new Date();const repo=createPrismaUsageRepository(prisma,()=>time),r=await repo.reserveUsage(spec(id,time));events.push(r.eventId!);
 await createPrismaAccountRepository(prisma).deleteAccountData(id);
 assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId}})).units,1);
 await assert.rejects(repo.beginUsageAttempt!(r.eventId!),{code:'AI_RESERVATION_EXPIRED'});
 time=new Date(time.getTime()+60001);await repo.reconcileExpiredUsage!({strict:true});
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{attempts:true}});assert.equal(row.units,0);assert.equal(row.creditsUsed,null);assert.equal(row.attempts.length,0);
 assert.equal((await aggregateQuotaUsage(prisma,{actions:['chat_message'],since:new Date(time.getTime()-3600000)})).requestCount,0);
});

it('retains anonymous unknown exposure before its fixed deadline and purges it afterwards without guessing settlement',async()=>{
 const id=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),r=await repo.reserveUsage(spec(id,time));events.push(r.eventId!);await repo.beginUsageAttempt!(r.eventId!);
 await repo.updateUsage({id:r.eventId!,status:'unknown'});await createPrismaAccountRepository(prisma).deleteAccountData(id);
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId}}),retention=createPrismaRetentionRepository(prisma),cutoffs={authTokensBefore:new Date(0),unverifiedAccountsBefore:new Date(0),usageBefore:new Date(time.getTime()+86400000)};
 await retention.purgeExpiredData(time,cutoffs,100);assert.equal(await prisma.usageEvent.count({where:{id:row.id}}),1);
 await retention.purgeExpiredData(new Date(row.anonymousUntil!.getTime()+1),cutoffs,100);assert.equal(await prisma.usageEvent.count({where:{id:row.id}}),0);
 assert.equal(await prisma.usageProviderAttempt.count({where:{eventId:row.id}}),0);
});

it('serializes deletion, duplicate late completion and fresh admission without freeing or charging the same exposure twice',async()=>{
 const id=await owner(),other=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),base=spec(id,time);
 const policy={creditLimit:1,requestLimit:1,since:new Date(time.getTime()-3600000),staleReservedCutoff:new Date(time.getTime()-1800000)};
 const r=await repo.reserveUsage({...base,globalGuard:policy});events.push(r.eventId!);await repo.beginUsageAttempt!(r.eventId!);
 const [deleted,...outcomes]=await Promise.all([createPrismaAccountRepository(prisma).deleteAccountData(id),...Array.from({length:4},()=>repo.updateUsage({id:r.eventId!,status:'completed',totalTokens:2000})),repo.reserveUsage({...spec(other,time),globalGuard:policy})]);
 const admission=outcomes.at(-1) as {accepted:boolean};assert.equal(admission.accepted,false);
 const row=await prisma.usageEvent.findUniqueOrThrow({where:{id:r.eventId},include:{settlementReceipts:true,attempts:true}});
 assert.equal(row.userId,null);assert.equal(row.creditsUsed,2);assert.equal(row.units,2);assert.equal(row.settlementReceipts.length,1);assert.equal(row.attempts.length,1);
});
