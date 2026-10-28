// Synthetic fixture for the recovery/runner terminal-state integration test.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma as db} from '../../../apps/api/src/db/prisma.ts';
import {createQaExecutionRepository,reapV2Executions} from '../../../apps/api/src/modules/qa-requests/qa-execution.repository.ts';
import {createBrowserRuntimeRepository} from '../../../apps/api/src/modules/browser-runtime/browser-runtime.repository.ts';
import {quotaBrowserFixture} from '../../../apps/api/tests/helpers/quotaBrowserFixture.ts';

assert.equal(process.env.ODDPATH_RECOVERY_BROWSER_TESTS,'SYNTHETIC_ONLY');
try {
 const time=new Date(),clock=()=>time,ownerId='recovery-browser-owner';
 await db.user.create({data:{id:ownerId,email:'recovery-browser@example.invalid'}});
 const f=await quotaBrowserFixture(db,ownerId,time);
 const executor=createQaExecutionRepository(db,clock,{allowV2:true,requireRuntime:true});
 const job=await executor.start(f.start);
 await db.qaExecutionJob.update({where:{id:job.executionId},data:{availableAt:time}});
 const claimed=await executor.claim(f.claim) as {claim:{claimId:string;leaseToken:string}}|null;
 assert.ok(claimed);
 const runtime=createBrowserRuntimeRepository(db,clock),runtimeId=randomUUID();
 await runtime.begin(f.connection.id,job.executionId,claimed.claim,{runtimeId,imageDigest:'sha256:'+'a'.repeat(64)});
 await executor.cancel({actor:f.actor,projectId:f.project.id,requestId:f.request.id,runId:job.runId});
 const stopping=await db.qaBrowserRuntime.findUniqueOrThrow({where:{runtimeId}});
 assert.equal(stopping.state,'STOP_REQUESTED');
 assert.equal(stopping.exitObservedAt,null);
 assert.equal((await db.qaBrowserReservation.findUniqueOrThrow({where:{executionId:job.executionId}})).state,'ACTIVE');
 const input={runtimeId,observedAt:time.toISOString(),processExited:true as const};
 await runtime.exit(f.connection.id,job.executionId,input);
 await runtime.exit(f.connection.id,job.executionId,input); // Idempotent delivery.
 await reapV2Executions(db,clock);
 const stopped=await db.qaBrowserRuntime.findUniqueOrThrow({where:{runtimeId}});
 const reservation=await db.qaBrowserReservation.findUniqueOrThrow({where:{executionId:job.executionId}});
 assert.equal(stopped.state,'STOP_CONFIRMED');
 assert.equal(stopped.exitObservedAt?.toISOString(),time.toISOString());
 assert.equal(reservation.state,'RELEASED');
 assert.equal((await db.qaExecutionJob.findUniqueOrThrow({where:{id:job.executionId}})).status,'CANCELLED');
 console.log(JSON.stringify({runtimeId,executionId:job.executionId,state:stopped.state,exitProof:true,reservation:reservation.state,
  producer:'ACTUAL_API_START_CLAIM_BEGIN_CANCEL_EXIT_REAPER',duplicateExitAccepted:true,holdRetainedUntilExit:true,
  physicalChrome:'NOT_STARTED_SYNTHETIC_EXIT_PROOF'}));
} finally {await db.$disconnect();}
