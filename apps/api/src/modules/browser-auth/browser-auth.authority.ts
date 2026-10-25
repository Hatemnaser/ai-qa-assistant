import type { ProfileManifestV2 } from '@oddpath/qa-execution-contract';
import type { Prisma } from '../../generated/prisma/client.js';
import { loadBrowserAuthVault, unavailable, type BrowserAuthVault } from './browser-auth.vault.js';

export function savedStateBinding(row: { id:string;ownerId:string;projectId:string;targetRevisionId:string;targetHash:string;revision:number;createdAt:Date;expiresAt:Date }) {
  return { id:row.id,ownerId:row.ownerId,projectId:row.projectId,targetRevisionId:row.targetRevisionId,targetHash:row.targetHash,revision:row.revision,createdAt:row.createdAt.getTime(),expiresAt:row.expiresAt.getTime() };
}
export async function requireSavedAuthentication(tx: Prisma.TransactionClient,projectId:string,profile:ProfileManifestV2,now:()=>Date,vault?:BrowserAuthVault) {
  if(profile.authentication.kind!=='SAVED_STATE')return null;
  const auth=profile.authentication;
  await tx.$executeRaw`SELECT 1 FROM "QaSavedBrowserState" WHERE "id"=${auth.id} FOR UPDATE`;
  const row=await tx.qaSavedBrowserState.findFirst({where:{id:auth.id,projectId,project:{ownerId:{not:''}}},include:{project:{select:{ownerId:true}}}});
  const currentTime=now();
  if(!row||row.ownerId!==row.project.ownerId||row.revision!==auth.revision||row.targetRevisionId!==auth.targetRevisionId
    ||row.targetRevisionId!==profile.target.revisionId||row.targetHash!==profile.target.targetHash||row.revokedAt||row.expiresAt<=currentTime
    ||!(vault??loadBrowserAuthVault()).revocations.allows(savedStateBinding(row),()=>now().getTime()))throw unavailable();
  return row;
}
