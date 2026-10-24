import type { prisma } from '../../db/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { calculateCreditsFromTokenUsage } from './credit-policy.js';
import { aggregateQuotaUsage } from './usage-quota.js';
import { summarizeAttemptAccounting } from './usage-accounting.js';
import { accountingUnavailable, captureUsageReceipt, confirmedUsage, retryAccounting } from './usage-receipts.js';
import { AI_USAGE_ACTIONS, type UsageAttemptDescriptor, type UsageReservationInput, type UsageUpdateInput } from './usage.types.js';
import { anonymousUsageInput } from './usage-privacy.js';

type Transaction = Prisma.TransactionClient;
type Event = NonNullable<Awaited<ReturnType<Transaction['usageEvent']['findUnique']>>>;
type StoredPolicy = Omit<UsageReservationInput, 'event' | 'since' | 'globalGuard'> & {
  since: string;
  globalGuard?: { creditLimit:number; requestLimit:number; since:string;
    additionalWindows?: Array<{creditLimit:number; requestLimit:number; since:string}> };
};

export function durableUsagePolicy(input: UsageReservationInput) {
  const {event: _event, ...policy}=input;
  return JSON.parse(JSON.stringify(policy)) as Prisma.InputJsonValue;
}

/** Same locks as initial reservations; settlement and every fallback share them. */
async function lockEvent(tx:Transaction,id:string) {
  const initial=await tx.usageEvent.findUnique({where:{id}});
  if(!initial)throw unavailable();
  const keys=['ai_operation:global',...(initial.userId ? [`ai_operation:user:${initial.userId}`]
    : [initial.guestId?`ai_operation:guest:${initial.guestId}`:'',initial.ipHash?`ai_operation:ip:${initial.ipHash}`:''].filter(Boolean))].sort();
  for(const key of keys)await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usage_quota'),hashtext(${key}))`;
  await tx.$executeRaw`SELECT 1 FROM "UsageEvent" WHERE "id"=${id} FOR UPDATE`;
  return tx.usageEvent.findUniqueOrThrow({where:{id}});
}

async function billedUnits(tx:Transaction,event:Event) {
  const attempts=await tx.usageProviderAttempt.findMany({where:{eventId:event.id}});
  return attempts.length ? event.fixedCredits+attempts.reduce((sum,row)=>sum+(row.creditsUsed??row.creditsReserved),0)
    : event.providerAttempts ? event.units : 0;
}

async function expire(tx:Transaction,event:Event,time:Date) {
  await tx.usageProviderAttempt.updateMany({where:{eventId:event.id,status:'started'},data:{status:'unknown',settledAt:time}});
  const units=await billedUnits(tx,event);
  await tx.usageEvent.update({where:{id:event.id},data:{status:'unknown',units,creditsUsed:null,settledAt:time}});
}

async function requireAttemptBudget(tx:Transaction,event:Event,policy:StoredPolicy,delta:number,time:Date) {
  const scope={actions:policy.scopeActions?.length?policy.scopeActions:[policy.action],since:new Date(policy.since)};
  const counts=event.userId ? [(await aggregateQuotaUsage(tx,{...scope,userId:event.userId})).unitsUsed]
    : await Promise.all([event.guestId?aggregateQuotaUsage(tx,{...scope,guestId:event.guestId}).then(row=>row.unitsUsed):0,event.ipHash?aggregateQuotaUsage(tx,{...scope,ipHash:event.ipHash}).then(row=>row.unitsUsed):0]);
  if(Math.max(...counts)+delta>policy.limit)throw new AppError('Daily credit limit reached.',429,'USAGE_LIMIT_REACHED');
  if(!policy.globalGuard)return;
  const guard=policy.globalGuard;
  // Advance the short rolling window. Secondary windows stay conservative
  // for this short hold; new calls cannot cross midnight because it expires.
  const rollingSince=new Date(time.getTime()-(event.createdAt.getTime()-new Date(guard.since).getTime()));
  for(const window of [{...guard,since:rollingSince},...(guard.additionalWindows??[])]){
    const usage=await aggregateQuotaUsage(tx,{since:new Date(window.since),actions:AI_ACTIONS});
    if(usage.unitsUsed+delta>window.creditLimit||usage.requestCount+(event.providerAttempts?1:0)>window.requestLimit)
      throw new AppError('AI usage is temporarily limited.',429,'AI_USAGE_LIMIT_REACHED');
  }
}

const AI_ACTIONS=[...AI_USAGE_ACTIONS];

async function settle(tx:Transaction,event:Event,input:UsageUpdateInput,time:Date){
  if(event.status==='failed')return;
  const attempts=await tx.usageProviderAttempt.findMany({where:{eventId:event.id},orderBy:{ordinal:'asc'},include:{settlementReceipt:true}});
  // Prefer the latest generation's durable metadata even if a later failure or
  // an older attempt's evidence reaches this boundary after the answer.
  const latestReceipt=attempts.slice().reverse().find(attempt=>attempt.settlementReceipt)?.settlementReceipt;
  if(latestReceipt)input=latestReceipt.payload as unknown as UsageUpdateInput;
  if(event.anonymousUntil)input=anonymousUsageInput(input);
  for(const attempt of attempts){
    const receipt=attempt.settlementReceipt;
    if(!receipt&&attempt.status!=='started')continue;
    const consumption=receipt?.payload as unknown as UsageUpdateInput|undefined;
    await tx.usageProviderAttempt.update({where:{id:attempt.id},data:{status:receipt?'completed':'unknown',creditsUsed:receipt?.credits??null,settledAt:time,
      ...(consumption?{promptTokens:consumption.promptTokens,outputTokens:consumption.outputTokens,totalTokens:consumption.totalTokens}:{})}});
  }
  const settledAttempts=await tx.usageProviderAttempt.findMany({where:{eventId:event.id},include:{settlementReceipt:true}});
  const summary=summarizeAttemptAccounting(event.fixedCredits,settledAttempts),last=attempts.at(-1);
  const {id:_id,attemptId:_attempt,providerAttempts:_count,units:_units,creditsUsed:_credits,status:_status,usageConfirmed:_confirmed,...metadata}=input;
  // Only confirmed attempt values contribute to token totals and final debits.
  const tokenTotals=Object.fromEntries((['promptTokens','outputTokens','totalTokens'] as const).map(key=>{
    const values=settledAttempts.map(attempt=>attempt[key]).filter((value):value is number=>value!==null);
    return [key,values.length?values.reduce((sum,value)=>sum+value,0):null];
  }));
  await tx.usageEvent.update({where:{id:event.id},data:{...metadata,...tokenTotals,model:last?.model??event.model,provider:last?.provider??event.provider,
    units:summary.units,creditsUsed:latestReceipt?summary.confirmedUnits:null,
    status:latestReceipt?(summary.unconfirmed?'partial':'completed'):attempts.length?'unknown':'failed',settledAt:time}});
  await tx.usageSettlementReceipt.updateMany({where:{eventId:event.id,appliedAt:null},data:{appliedAt:time}});
}

export function createDurableUsageLedger(database:typeof prisma,now:()=>Date) {
  return {
    async begin(id:string,descriptor:UsageAttemptDescriptor={}) {
      const result=await database.$transaction(async tx=>{
        const event=await lockEvent(tx,id),time=now();
        if(event.anonymousUntil||!event.reservationPolicy||!event.expiresAt||event.status!=='reserved')return {expired:true};
        if(await tx.usageSettlementReceipt.findFirst({where:{eventId:id}}))return {expired:true};
        if(event.expiresAt<=time){await expire(tx,event,time);return {expired:true};}
        const policy=event.reservationPolicy as unknown as StoredPolicy;
        const model=descriptor.model??event.model,provider=descriptor.provider??event.provider,kind=descriptor.kind??'generation';
        const reserved=kind==='router'?0:calculateCreditsFromTokenUsage({model:model??undefined,totalTokens:event.estimatedTotalTokens??undefined,fallbackCredits:Math.max(1,(event.creditsReserved??event.units)-event.fixedCredits)});
        const held=Math.max(event.units,await billedUnits(tx,event)+reserved+(event.providerAttempts?0:event.fixedCredits));
        await requireAttemptBudget(tx,event,policy,held-event.units,time);
        const decisionAt=now();
        if(event.expiresAt<=decisionAt){await expire(tx,event,decisionAt);return {expired:true};}
        await tx.usageProviderAttempt.create({data:{eventId:id,ordinal:event.providerAttempts+1,kind,model,provider,creditsReserved:reserved,startedAt:decisionAt}});
        await tx.usageEvent.update({where:{id},data:{units:held,providerAttempts:{increment:1}}});
        return {expired:false};
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
      if(result.expired)throw unavailable();
    },
    async finalize(input:UsageUpdateInput) {
      let initial:Event|null;
      try{initial=await retryAccounting(()=>database.usageEvent.findUnique({where:{id:input.id}}));}
      catch{throw accountingUnavailable();}
      if(!initial?.reservationPolicy)return false;
      if(input.status==='completed'&&confirmedUsage(input)){
        try{await retryAccounting(()=>database.$transaction(async tx=>{
          const event=await lockEvent(tx,input.id);
          if(event.status==='failed')return;
          await captureUsageReceipt(tx,event,input,now());
        },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted}));}
        catch(error){if(error instanceof AppError)throw error;throw accountingUnavailable();}
      }
      try{await retryAccounting(()=>database.$transaction(async tx=>{
        const event=await lockEvent(tx,input.id);await settle(tx,event,input,now());
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted}));}
      catch{throw new AppError('Usage receipt is awaiting reconciliation.',503,'AI_USAGE_SETTLEMENT_PENDING');}
      return true;
    },
    async recover(id:string){
      return retryAccounting(()=>database.$transaction(async tx=>{
        const event=await lockEvent(tx,id),receipt=await tx.usageSettlementReceipt.findFirst({where:{eventId:id,appliedAt:null}});
        if(!receipt)return 0;
        await settle(tx,event,receipt.payload as unknown as UsageUpdateInput,now());return 1;
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted}));
    },
    async cleanup(id:string) {
      return database.$transaction(async tx=>{
        const event=await lockEvent(tx,id);
        const receipt=await tx.usageSettlementReceipt.findFirst({where:{eventId:id,appliedAt:null}});
        if(receipt&&!receipt.appliedAt){await settle(tx,event,receipt.payload as unknown as UsageUpdateInput,now());return 1;}
        if(!event.reservationPolicy||event.status!=='reserved'||!event.expiresAt||event.expiresAt>now())return 0;
        await expire(tx,event,now());return 1;
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    },
  };
}

function unavailable(){return new AppError('AI reservation expired or is no longer active.',409,'AI_RESERVATION_EXPIRED');}
