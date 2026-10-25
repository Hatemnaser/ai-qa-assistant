import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';

export const BROWSER_LIMITS=Object.freeze({activeGlobal:1,pendingPerOwner:1,dailyPerOwner:3,queuedGlobal:10,waitMs:600_000});

async function lockCapacity(tx:Prisma.TransactionClient){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'oddpath:browser-capacity'},0))`;
}

/** No timer/lease alone can free an allocated browser: physical exit is required. */
export async function reconcileBrowserReservations(tx:Prisma.TransactionClient,now:()=>Date){
  await lockCapacity(tx);const time=now();
  await tx.qaBrowserReservation.updateMany({where:{state:'QUEUED',OR:[{queueExpiresAt:{lte:time}},{execution:{status:{in:['SUCCEEDED','FAILED','CANCELLED']}}}]},data:{state:'RELEASED',releasedAt:time}});
  await tx.qaBrowserReservation.updateMany({where:{state:'ACTIVE',execution:{OR:[{browserRuntime:{is:{state:'STOP_CONFIRMED'}}},{status:{in:['SUCCEEDED','FAILED','CANCELLED']},browserRuntime:{is:null}}]}},data:{state:'RELEASED',releasedAt:time}});
}

export async function reserveBrowser(tx:Prisma.TransactionClient,executionId:string,ownerId:string,deadline:Date,now:()=>Date){
  await reconcileBrowserReservations(tx,now);const time=now();
  if(deadline<=time)throw quota('QA_EXECUTION_APPROVAL_INVALID','Execution approval expired.');
  if(await tx.qaBrowserReservation.count({where:{ownerId,state:{in:['QUEUED','ACTIVE']}}})
    ||await tx.qaBrowserRuntime.count({where:{state:{not:'STOP_CONFIRMED'},execution:{project:{ownerId}}}}))
    throw quota('BROWSER_ACCOUNT_BUSY','An account may have one queued or active browser.');
  if(await tx.qaBrowserReservation.count({where:{state:'QUEUED'}})>=BROWSER_LIMITS.queuedGlobal)
    throw quota('BROWSER_QUEUE_FULL','The browser queue is full. Try again later.');
  const day=new Date(time);day.setUTCHours(0,0,0,0);
  const used=await tx.qaBrowserDailyUsage.findUnique({where:{ownerId_day:{ownerId,day}}});
  if((used?.count??0)>=BROWSER_LIMITS.dailyPerOwner)throw quota('BROWSER_DAILY_LIMIT','Daily browser allocation limit reached.');
  await tx.qaBrowserDailyUsage.upsert({where:{ownerId_day:{ownerId,day}},create:{ownerId,day,count:1},update:{count:{increment:1}}});
  const decisionAt=now();
  if(deadline<=decisionAt||day.toISOString().slice(0,10)!==decisionAt.toISOString().slice(0,10))throw quota('QA_EXECUTION_APPROVAL_INVALID','Browser reservation window changed. Review and approve again.');
  await tx.qaBrowserReservation.create({data:{executionId,ownerId,queuedAt:decisionAt,queueExpiresAt:new Date(Math.min(deadline.getTime(),decisionAt.getTime()+BROWSER_LIMITS.waitMs))}});
}

export async function grantBrowser(tx:Prisma.TransactionClient,executionId:string,now:()=>Date):Promise<'GRANTED'|'WAITING'|'EXPIRED'>{
  await reconcileBrowserReservations(tx,now);const time=now();
  const reservation=await tx.qaBrowserReservation.findUnique({where:{executionId}});
  if(!reservation||reservation.state!=='QUEUED'||reservation.queueExpiresAt<=time)return 'EXPIRED';
  if(await tx.qaBrowserReservation.count({where:{state:'ACTIVE'}})>=BROWSER_LIMITS.activeGlobal
    ||await tx.qaBrowserRuntime.count({where:{state:{not:'STOP_CONFIRMED'}}}))return 'WAITING';
  const head=await tx.qaBrowserReservation.findFirst({where:{state:'QUEUED',queueExpiresAt:{gt:time},execution:{status:'QUEUED',availableAt:{lte:time},deadlineAt:{gt:time}}},orderBy:[{queuedAt:'asc'},{executionId:'asc'}]});
  if(head?.executionId!==executionId)return 'WAITING';
  const decisionAt=now();
  if(reservation.queueExpiresAt<=decisionAt){await tx.qaBrowserReservation.update({where:{executionId},data:{state:'RELEASED',releasedAt:decisionAt}});return 'EXPIRED';}
  await tx.qaBrowserReservation.update({where:{executionId},data:{state:'ACTIVE',grantedAt:decisionAt}});
  return 'GRANTED';
}

export async function requireBrowserReservation(tx:Prisma.TransactionClient,executionId:string){
  if((await tx.qaBrowserReservation.findUnique({where:{executionId}}))?.state!=='ACTIVE')
    throw quota('QA_EXECUTION_APPROVAL_INVALID','A current browser reservation is required.');
}
function quota(code:string,message:string){return new AppError(message,429,code);}
