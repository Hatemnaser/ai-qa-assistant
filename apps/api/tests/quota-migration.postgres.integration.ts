import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';

const target=assertPostgresIntegrationTarget(process.env);
if(process.env.ODDPATH_QUOTA_UPGRADE_TEST!=='1')throw new Error('This upgrade rehearsal requires its own EMPTY disposable database and ODDPATH_QUOTA_UPGRADE_TEST=1.');
test('06B additive migration preserves existing daily consumption and unconfirmed occupied browsers',async()=>{
 const pool=new Pool({connectionString:target.connectionString});let disconnect:(()=>Promise<void>)|undefined;
 try{
  assert.equal((await pool.query(`SELECT to_regclass('public."User"') AS relation`)).rows[0].relation,null,'Refusing to bootstrap a nonempty database');
  const directory=new URL('../prisma/migrations/',import.meta.url),migration='20261014180000_durable_usage_browser_reservations';
  const files=(await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  for(const name of files.filter(name=>name<migration))await pool.query(await readFile(new URL(name+'/migration.sql',directory),'utf8'));
  // The current generated client selects this later nullable routing column.
  // Supply only that unrelated additive migration before seeding the historical
  // fixture; the 06B migrations under test must still run AFTER its old data.
  await pool.query(await readFile(new URL('20261020000100_managed_project_routing/migration.sql',directory),'utf8'));
  const {prisma}=await import('../src/db/prisma.ts');disconnect=()=>prisma.$disconnect();
  const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
  const {createQaExecutionRepository}=await import('../src/modules/qa-requests/qa-execution.repository.ts');
  const {createBrowserRuntimeRepository}=await import('../src/modules/browser-runtime/browser-runtime.repository.ts');
  const id='quota-upgrade-'+randomUUID(),time=new Date();await prisma.user.create({data:{id,email:id+'@example.test'}});
  const executor=createQaExecutionRepository(prisma,()=>time,{allowV2:true,enforceBrowserQuota:false});
  const runtime=createBrowserRuntimeRepository(prisma,()=>time,{enforceBrowserQuota:false});
  const queued=await quotaBrowserFixture(prisma,id,time),a=await quotaBrowserFixture(prisma,id,time),b=await quotaBrowserFixture(prisma,id,time);
  const queuedJob=await executor.start(queued.start),aJob=await executor.start(a.start),bJob=await executor.start(b.start);
  await prisma.qaExecutionJob.updateMany({where:{id:{in:[queuedJob.executionId,aJob.executionId,bJob.executionId]}},data:{createdAt:time,availableAt:time}});
  for(const [fixture,job] of [[a,aJob],[b,bJob]] as const){
   const claim=await executor.claim(fixture.claim) as {claim:{claimId:string;leaseToken:string}};assert.ok(claim);
   await runtime.begin(fixture.connection.id,job.executionId,claim.claim,{runtimeId:randomUUID(),imageDigest:'sha256:'+'a'.repeat(64)});
  }
  await prisma.qaExecutionJob.update({where:{id:bJob.executionId},data:{status:'FAILED',leaseExpiresAt:null,leaseTokenHash:null}});
  await prisma.qaBrowserRuntime.update({where:{executionId:bJob.executionId},data:{state:'STOP_UNCONFIRMED',stopRequestedAt:time}});
  const ambiguousJobId='ambiguous-upgrade-'+randomUUID();
  await pool.query('INSERT INTO "QaGenerationExecution" ("id","requestId","kind","status","attempts","updatedAt") VALUES ($1,$2,\'CHECKLIST_GENERATION\',\'PENDING\',1,NOW())',[ambiguousJobId,queued.request.id]);
  await pool.query(await readFile(new URL(migration+'/migration.sql',directory),'utf8'));
  const protectionMigration='20261015000300_protect_deleted_usage_and_qa_generation';
  // The generated client includes the new nullable fields; apply them before
  // using it to create the older receipt fixtures below.
  await pool.query(await readFile(new URL(protectionMigration+'/migration.sql',directory),'utf8'));
  assert.ok((await prisma.qaGenerationExecution.findUniqueOrThrow({where:{id:ambiguousJobId}})).providerStartedAt,'Old ambiguous work must not silently gain authority to regenerate after upgrade');
  const reservations=await prisma.qaBrowserReservation.findMany({orderBy:{executionId:'asc'}});
  assert.equal(reservations.find(row=>row.executionId===queuedJob.executionId)?.state,'QUEUED');
  assert.ok([aJob.executionId,bJob.executionId].every(executionId=>reservations.find(row=>row.executionId===executionId)?.state==='ACTIVE'));
  assert.equal((await prisma.qaBrowserDailyUsage.findFirstOrThrow({where:{ownerId:id}})).count,3);
  const {grantBrowser}=await import('../src/modules/browser-runtime/browser-reservations.ts');
  assert.equal(await prisma.$transaction(tx=>grantBrowser(tx,queuedJob.executionId,()=>time)),'WAITING');
  const legacy=await prisma.usageEvent.create({data:{userId:id,action:'chat_message',status:'unknown',units:2}});
  const durable=await prisma.usageEvent.create({data:{userId:id,action:'chat_message',status:'unknown',units:2,creditsReserved:2,providerAttempts:1,model:'gemini-3.1-flash-lite',reservationPolicy:{action:'chat_message',userId:id,isSignedIn:true,limit:100,requestedUnits:2,since:new Date(time.getTime()-86400000).toISOString()},expiresAt:new Date(time.getTime()+60000)}});
  await prisma.usageProviderAttempt.create({data:{eventId:durable.id,ordinal:1,kind:'generation',creditsReserved:2,status:'unknown',model:'gemini-3.1-flash-lite',startedAt:time}});
  const receiptMigration='20261015000100_usage_settlement_receipts';
  await pool.query(await readFile(new URL(receiptMigration+'/migration.sql',directory),'utf8'));
  // A populated previous-repair schema, including its incorrectly confirmed
  // mixed event. The upgrade must preserve the receipt and quota exposure.
  const mixed=await prisma.usageEvent.create({data:{userId:id,action:'chat_message',status:'completed',units:3,creditsUsed:3,providerAttempts:2,reservationPolicy:{action:'chat_message'},expiresAt:time}});
  const first=await prisma.usageProviderAttempt.create({data:{eventId:mixed.id,ordinal:1,kind:'generation',status:'unknown',creditsReserved:1,model:'gemini-3.1-flash-lite'}});
  const second=await prisma.usageProviderAttempt.create({data:{eventId:mixed.id,ordinal:2,kind:'generation',status:'completed',creditsReserved:1,creditsUsed:2,totalTokens:2000,model:'gemini-3.1-flash-lite'}});
  await prisma.usageSettlementReceipt.create({data:{eventId:mixed.id,attemptId:second.id,credits:2,fingerprint:createHash('sha256').update(JSON.stringify([second.id,2000,null,null,2])).digest('hex'),payload:{id:mixed.id,status:'completed',totalTokens:2000},appliedAt:time}});
  const partialMigration='20261015000200_per_attempt_usage_receipts';
  await pool.query(await readFile(new URL(partialMigration+'/migration.sql',directory),'utf8'));
  const upgraded=await prisma.usageEvent.findUniqueOrThrow({where:{id:mixed.id},include:{settlementReceipts:true}});
  assert.equal(upgraded.status,'partial');assert.equal(upgraded.creditsUsed,2);assert.equal(upgraded.units,3);assert.equal(upgraded.settlementReceipts.length,1);
  const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
  await createPrismaUsageRepository(prisma,()=>time).updateUsage({id:durable.id,status:'completed',totalTokens:100});
  assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:legacy.id}})).units,2);
  assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:durable.id}})).units,1);
  assert.equal((await prisma.usageSettlementReceipt.findFirstOrThrow({where:{eventId:durable.id}})).credits,1);
  await createPrismaUsageRepository(prisma,()=>time).updateUsage({id:mixed.id,attemptId:first.id,status:'completed',totalTokens:100});
  assert.equal((await prisma.usageEvent.findUniqueOrThrow({where:{id:mixed.id}})).status,'completed');
  assert.equal(await prisma.usageSettlementReceipt.count({where:{eventId:mixed.id}}),2);
  if(process.env.ODDPATH_QUOTA_UPGRADE_PROOF_FILE)await writeFile(process.env.ODDPATH_QUOTA_UPGRADE_PROOF_FILE,JSON.stringify({database:target.databaseName,previousMigrations:files.filter(name=>name<migration).length,newMigration:migration,receiptMigration,partialMigration,queued:1,occupied:2,dailyCount:3,unconfirmedBlocksGrant:true,legacyChargePreserved:2,existingAttemptReconciled:1,mixedEventUpgraded:{quotaUnits:3,confirmedCredits:2,status:'partial',receiptsPreserved:1},lateEvidenceReceipts:2},null,2));
 }finally{await disconnect?.();await pool.end();}
});
