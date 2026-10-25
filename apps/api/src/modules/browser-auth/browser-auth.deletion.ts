import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { lockTestProject } from '../test-sessions/test-sessions.guard.js';
import { loadBrowserAuthVault,type BrowserAuthVault } from './browser-auth.vault.js';

// Called inside the actual deletion transaction, after owner/password checks.
// Flag disable cannot bypass old allocations or independently retained identity.
export async function lockBrowserDeletion(tx:Prisma.TransactionClient,ownerId:string,projectId?:string){
  const tables=await tx.$queryRaw<Array<{saved:boolean;runtime:boolean}>>`SELECT to_regclass('public."QaSavedBrowserState"') IS NOT NULL AS saved,to_regclass('public."QaBrowserRuntime"') IS NOT NULL AS runtime`;
  if(!tables[0]?.saved&&!tables[0]?.runtime)return false;
  if(projectId)await lockTestProject(tx,projectId);
  else{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:projects:${ownerId}`},0))`;
    const projects=await tx.project.findMany({where:{ownerId},select:{id:true},orderBy:{id:'asc'}});
    for(const project of projects)await lockTestProject(tx,project.id);
    await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id"=${ownerId} FOR UPDATE`;
  }
  if(tables[0]?.runtime&&await tx.qaBrowserRuntime.count({where:{state:{not:'STOP_CONFIRMED'},execution:{project:{ownerId},...(projectId?{projectId}:{})}}}))throw new AppError('Browser Stop must be confirmed before deletion.',409,'BROWSER_STOP_REQUIRED');
  return !!tables[0]?.saved;
}
export async function revokeDeletedBrowserScope(tx:Prisma.TransactionClient,ownerId:string,projectId?:string,getVault:()=>BrowserAuthVault=()=>loadBrowserAuthVault(false)){
  if(!await tx.qaSavedBrowserState.count({where:{ownerId,...(projectId?{projectId}:{})}}))return;
  getVault().revocations.revokeScope(projectId?'project':'owner',projectId??ownerId,Date.now(),true);
}
