import type { prisma } from '../../db/prisma.js';
import { AppError } from '../../lib/errors.js';
import { retryAccounting } from '../usage/usage-receipts.js';
import type { ClaimedQaProcessingJob } from './qa-processing.types.js';

/** Durable before provider authority: lost work requires explicit recovery. */
export async function runQaProviderOnce<T>(database:typeof prisma,job:ClaimedQaProcessingJob,signal:AbortSignal,generate:()=>Promise<T>){
  await database.$transaction(async tx=>{
    await tx.$executeRaw`SELECT 1 FROM "QaGenerationExecution" WHERE "id"=${job.id} FOR UPDATE`;
    // Lock waits must not reuse a timestamp from before the wait.
    const decisionAt=new Date();
    const started=await tx.qaGenerationExecution.updateMany({where:{id:job.id,status:'PROCESSING',leaseToken:job.leaseToken,
      leaseExpiresAt:{gt:decisionAt},providerStartedAt:null},data:{providerStartedAt:decisionAt}});
    if(started.count===1)return;
    if(await tx.qaGenerationExecution.count({where:{id:job.id,providerStartedAt:{not:null}}}))
      throw new AppError('A previous generation may have completed. Retry explicitly; automatic provider replay is disabled.',409,'QA_PROVIDER_OUTCOME_UNKNOWN');
    throw new AppError('QA processing lease is no longer current.',409,'QA_PROCESSING_LEASE_LOST');
  });
  if(signal.aborted||job.leaseExpiresAt<=new Date())throw new AppError('QA processing was interrupted before generation.',409,'QA_PROVIDER_OUTCOME_UNKNOWN');
  return generate();
}

/** The generated value stays in memory across DB-only publication retries. */
export function publishQaResult(database:typeof prisma,job:ClaimedQaProcessingJob,publish:()=>Promise<unknown>){
  return retryAccounting(async()=>{
    // A lost commit acknowledgement may hide a successful publication.
    if(await database.qaGenerationExecution.count({where:{id:job.id,status:'SUCCEEDED'}}))return;
    await publish();
  });
}
