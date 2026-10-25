import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { calculateCreditsFromTokenUsage } from './credit-policy.js';
import type { UsageUpdateInput } from './usage.types.js';
import { summarizeAttemptAccounting } from './usage-accounting.js';
import { anonymousUsageInput } from './usage-privacy.js';

type Event=NonNullable<Awaited<ReturnType<Prisma.TransactionClient['usageEvent']['findUnique']>>>;
export function confirmedUsage(input:UsageUpdateInput){
  return input.usageConfirmed??Boolean((input.totalTokens??0)>0||(input.promptTokens??0)+(input.outputTokens??0)>0||input.creditsUsed!==undefined);
}

/** Receipt commit is deliberately independent of the later debit transaction. */
export async function captureUsageReceipt(tx:Prisma.TransactionClient,event:Event,input:UsageUpdateInput,time:Date){
  if(event.anonymousUntil)input=anonymousUsageInput(input);
  const tokenValues=[input.totalTokens,input.promptTokens,input.outputTokens].filter((value):value is number=>value!==undefined);
  if(tokenValues.some(value=>!Number.isSafeInteger(value)||value<0)
    ||(input.creditsUsed!==undefined&&(!Number.isSafeInteger(input.creditsUsed)||input.creditsUsed<0)))throw accountingUnavailable();
  const hasTokens=tokenValues.some(value=>value>0);
  // A caller's confirmation flag is not a consumption value. In particular,
  // an empty/zero-token payload must never fall back to the reserved estimate.
  if(!hasTokens&&input.creditsUsed===undefined)throw accountingUnavailable();
  const attempt=await tx.usageProviderAttempt.findFirst({where:{eventId:event.id,...(input.attemptId?{id:input.attemptId}:{})},orderBy:{ordinal:'desc'}});
  if(!attempt||attempt.kind!=='generation')throw accountingUnavailable();
  const credits=hasTokens?calculateCreditsFromTokenUsage({model:attempt.model??undefined,promptTokens:input.promptTokens,outputTokens:input.outputTokens,totalTokens:input.totalTokens})
    :input.creditsUsed!;
  const fingerprint=createHash('sha256').update(JSON.stringify([attempt.id,input.totalTokens??null,input.promptTokens??null,input.outputTokens??null,credits])).digest('hex');
  const existing=await tx.usageSettlementReceipt.findUnique({where:{attemptId:attempt.id}});
  if(existing){
    if(existing.fingerprint!==fingerprint)throw new AppError('Conflicting usage receipt. Reconciliation is required.',409,'AI_USAGE_RECEIPT_CONFLICT');
    return existing;
  }
  const {usageConfirmed:_confirmed,...payload}=input;
  const receipt=await tx.usageSettlementReceipt.create({data:{eventId:event.id,attemptId:attempt.id,fingerprint,credits,payload:JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,createdAt:time}});
  const attempts=await tx.usageProviderAttempt.findMany({where:{eventId:event.id},include:{settlementReceipt:true}});
  const {units}=summarizeAttemptAccounting(event.fixedCredits,attempts);
  // Publish the known hold, not a settled debit. Updating the parent also makes
  // concurrent Serializable retention fail rather than delete a newer receipt.
  await tx.usageEvent.update({where:{id:event.id},data:{status:'settlement_pending',units,creditsUsed:null}});
  return receipt;
}

export async function retryAccounting<T>(operation:()=>Promise<T>){
  // Only database accounting is retried; this module has no provider dependency.
  let failure:unknown;
  for(let attempt=0;attempt<3;attempt++){
    try{return await operation();}catch(error){
      if(error instanceof AppError)throw error;
      failure=error;
    }
  }
  throw failure;
}

export function accountingUnavailable(){return new AppError('AI completed but its accounting could not be confirmed. Do not automatically retry the provider call.',503,'AI_USAGE_ACCOUNTING_UNAVAILABLE');}
