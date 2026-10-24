import type { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import type { UsageUpdateInput } from './usage.types.js';

const DAY_MS=86_400_000;

/** Keep only consumption values, never request context or deleted identities. */
export function anonymousUsageInput(input:UsageUpdateInput):UsageUpdateInput {
  return {id:input.id,attemptId:input.attemptId,status:input.status,
    usageConfirmed:input.usageConfirmed,creditsUsed:input.creditsUsed,
    totalTokens:input.totalTokens,promptTokens:input.promptTokens,outputTokens:input.outputTokens};
}

/** Same order as admission/settlement, before any owner/graph deletion locks. */
export async function lockUsageDeletion(tx:Prisma.TransactionClient,userId:string){
  for(const key of ['ai_operation:global',`ai_operation:user:${userId}`].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usage_quota'),hashtext(${key}))`;
}

export async function anonymizeDeletedUsage(tx:Prisma.TransactionClient,userId:string,time:Date){
  // A full calendar month is at most 31 days. Also honor a longer explicitly
  // configured rolling guard; expiry is finite and cannot be extended by reads.
  const retainMs=Math.max(32*DAY_MS,env.aiGlobalUsageWindowMs+DAY_MS);
  const events=await tx.usageEvent.findMany({where:{userId},include:{attempts:{select:{startedAt:true}},settlementReceipts:true}});
  for(const event of events){
    const lastExposure=Math.max(event.createdAt.getTime(),event.expiresAt?.getTime()??0,...event.attempts.map(a=>a.startedAt.getTime()));
    const anonymousUntil=new Date(lastExposure+retainMs);
    if(anonymousUntil<=time){await tx.usageEvent.delete({where:{id:event.id}});continue;}
    for(const receipt of event.settlementReceipts){
      const payload=anonymousUsageInput(receipt.payload as unknown as UsageUpdateInput);
      await tx.usageSettlementReceipt.update({where:{attemptId:receipt.attemptId},data:{payload:JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue}});
    }
    await tx.usageEvent.update({where:{id:event.id},data:{userId:null,guestId:null,ipHash:null,anonymousUntil,
      mode:null,workflowIntent:null,workflowSource:null,modelRoutingSource:null,provider:null,model:null,
      estimatedPromptTokens:null,estimatedOutputTokens:null,estimatedTotalTokens:null,
      attachmentCount:0,imageCount:0,fileCount:0,
      reservationPolicy:event.reservationPolicy?{anonymized:true}:undefined}});
  }
}
