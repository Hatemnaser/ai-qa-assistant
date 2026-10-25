import { profileManifestV2Schema,targetDefinitionSchema } from '@oddpath/qa-execution-contract';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { lockTestProject,lockQaSessionScope } from '../test-sessions/test-sessions.guard.js';
import { cancelLockedExecution } from '../qa-requests/qa-execution.repository.js';
import { savedStateBinding } from './browser-auth.authority.js';
import { loadBrowserAuthVault,type BrowserAuthVault } from './browser-auth.vault.js';
import type { BrowserAuthRepository } from './browser-auth.types.js';

export function createBrowserAuthRepository(database:typeof prisma=prisma,now=()=>new Date(),getVault:()=>BrowserAuthVault=loadBrowserAuthVault):BrowserAuthRepository {
  async function owner(tx:Prisma.TransactionClient,ownerId:string,projectId:string){
    await lockTestProject(tx,projectId);
    if(!await tx.project.findFirst({where:{id:projectId,ownerId}}))throw new AppError('Project was not found.',404,'PROJECT_NOT_FOUND');
  }
  return {
    async list(ownerId,projectId){
      return database.$transaction(async tx=>{
        await owner(tx,ownerId,projectId);const vault=getVault();
        const rows=await tx.qaSavedBrowserState.findMany({where:{ownerId,projectId},take:20,orderBy:[{revokedAt:{sort:'asc',nulls:'first'}},{expiresAt:'desc'}],select:{id:true,ownerId:true,projectId:true,targetRevisionId:true,targetHash:true,revision:true,createdAt:true,expiresAt:true,revokedAt:true}});
        const targets=await tx.qaTargetRevision.findMany({where:{id:{in:rows.map(row=>row.targetRevisionId)},target:{projectId}},select:{id:true,definition:true,target:{select:{label:true}}}});
        return rows.map(row=>{const target=targets.find(target=>target.id===row.targetRevisionId),definition=targetDefinitionSchema.safeParse(target?.definition);return {id:row.id,revision:row.revision,targetRevisionId:row.targetRevisionId,targetHash:row.targetHash,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),
          targetLabel:target?.target.label??null,targetUrl:definition.success?definition.data.baseUrl:null,
          revoked:!!row.revokedAt||!vault.revocations.allows(savedStateBinding(row),()=>now().getTime())};});
      });
    },
    async revoke(ownerId,projectId,id,actor={kind:'USER',transport:'WEB',userId:ownerId}){
      return database.$transaction(async tx=>{
        await owner(tx,ownerId,projectId);
        const row=await tx.qaSavedBrowserState.findFirst({where:{id,ownerId,projectId}});if(!row)throw new AppError('Saved login was not found.',404,'BROWSER_SAVED_LOGIN_NOT_FOUND');
        // Independent durable tombstone is written BEFORE PostgreSQL mutation.
        // A rolled-back transaction/old backup must never resurrect authority.
        getVault().revocations.revoke(id,now().getTime());
        await tx.qaSavedBrowserState.update({where:{id},data:{revokedAt:row.revokedAt??now(),sealedState:{}}});
        const jobs=await tx.qaExecutionJob.findMany({where:{projectId,protocolVersion:2,status:{in:['QUEUED','CLAIMED','RUNNING']}},select:{id:true,requestId:true,recipe:{select:{profileManifest:true}}}});
        for(const job of jobs){
          const profile=profileManifestV2Schema.safeParse(job.recipe.profileManifest);
          if(!profile.success||profile.data.authentication.kind!=='SAVED_STATE'||profile.data.authentication.id!==id)continue;
          await lockQaSessionScope(tx,job.requestId);await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${job.requestId}`},0))`;
          const current=await tx.qaExecutionJob.findUnique({where:{id:job.id},include:{request:true}});
          if(current)await cancelLockedExecution(tx,current,actor,now());
        }
        const active=await tx.qaBrowserRuntime.findMany({where:{state:{not:'STOP_CONFIRMED'},execution:{projectId}},select:{runtimeId:true,state:true,execution:{select:{recipe:{select:{profileManifest:true}}}}}});
        let pending=false;
        for(const runtime of active){const p=profileManifestV2Schema.safeParse(runtime.execution.recipe.profileManifest);if(p.success&&p.data.authentication.kind==='SAVED_STATE'&&p.data.authentication.id===id){
          pending=true;if(runtime.state==='LIVE')await tx.qaBrowserRuntime.update({where:{runtimeId:runtime.runtimeId},data:{state:'STOP_REQUESTED',stopRequestedAt:now()}});
        }}
        return {revoked:true as const,stopConfirmed:!pending};
      });
    },
    async cleanupExpired(){
      const rows=await database.qaSavedBrowserState.findMany({where:{revokedAt:null,expiresAt:{lte:now()}},take:20,orderBy:{expiresAt:'asc'},select:{id:true,ownerId:true,projectId:true}});
      for(const row of rows)await this.revoke(row.ownerId,row.projectId,row.id,{kind:'SYSTEM',transport:'SYSTEM'});
      return rows.length;
    },
    async revokeOwner(ownerId,projectId){
      const projects=await database.project.findMany({where:{ownerId,...(projectId?{id:projectId}:{})},select:{id:true},orderBy:{id:'asc'}});
      for(const project of projects)await database.$transaction(async tx=>{
        await owner(tx,ownerId,project.id);const vault=getVault();
        vault.revocations.revokeScope(projectId?'project':'owner',projectId??ownerId,now().getTime());
        await tx.qaSavedBrowserState.updateMany({where:{ownerId,projectId:project.id,revokedAt:null},data:{revokedAt:now(),sealedState:{}}});
      });
    },
  };
}
export const browserAuthRepository=createBrowserAuthRepository();
export async function revokeSavedOwner(ownerId:string,projectId?:string){
  // Existing pre-3B databases remain usable while the feature is off. Once
  // records exist, deletion/logout cannot bypass tombstones by disabling a flag.
  const tables=await prisma.$queryRaw<Array<{exists:boolean}>>`SELECT to_regclass('public."QaSavedBrowserState"') IS NOT NULL AS "exists"`;
  if(!tables[0]?.exists||!await prisma.qaSavedBrowserState.count({where:{ownerId,...(projectId?{projectId}:{})}}))return;
  await createBrowserAuthRepository(prisma,()=>new Date(),()=>loadBrowserAuthVault(false)).revokeOwner(ownerId,projectId);
}
