import {closedBrowserOwnerAllowed} from '../../config/closed-browser.js';
import {createHash, createHmac,timingSafeEqual} from 'node:crypto';
import {env} from '../../config/env.js';
import {AppError} from '../../lib/errors.js';
import type {Prisma} from '../../generated/prisma/client.js';

type Binding = {id:string;projectId:string;ownerId:string;managedHostId:string|null;tokenHash:string};
export function isManagedHostCredential(value:string|undefined){
  return env.qaManagedRoutingEnabled&&!!value&&/^[a-f0-9]{64}$/.test(value)&&/^[a-f0-9]{64}$/.test(env.qaManagedRoutingKey)
    &&timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(env.qaManagedRoutingKey,'hex'));
}
export function managedProjectToken(binding:Omit<Binding,'tokenHash'>,key=env.qaManagedProjectKey) {
  return 'odp_live_'+createHmac('sha256',Buffer.from(key,'hex'))
    .update(JSON.stringify(['oddpath-managed-project-v1',binding.id,binding.projectId,binding.ownerId,binding.managedHostId])).digest('base64url');
}
export function currentManagedBinding(binding:Binding) {
  return !binding.managedHostId || (env.qaManagedRoutingEnabled && binding.managedHostId===env.qaManagedHostId
    && createHash('sha256').update(managedProjectToken(binding)).digest('hex')===binding.tokenHash);
}
// Serialize admissions with revocation. Caller first owns its existing lifecycle
// locks; a generic token revoke takes only this row lock, never the reverse order.
export async function requireManagedAdmission(tx:Prisma.TransactionClient,connectionId:string,now:()=>Date) {
  // Managed IDs are issued only by the internal provisioner; legacy owner APIs
  // cannot choose connection IDs. Legacy contracts remain unchanged outside
  // the explicit managed-only closed rehearsal.
  if(!connectionId.startsWith('mb-')&&!env.qaClosedRehearsalEnabled)return;
  await tx.$queryRaw`SELECT id FROM "ProjectConnectionToken" WHERE id=${connectionId} FOR SHARE`;
  const current=await tx.projectConnectionToken.findUnique({where:{id:connectionId},include:{project:{select:{ownerId:true}},owner:{select:{emailVerifiedAt:true}}}});
  if(!current || !closedBrowserOwnerAllowed(env,current.ownerId) || (env.qaClosedRehearsalEnabled&&current.managedHostId!==env.qaManagedHostId) || current.revokedAt || (current.expiresAt && current.expiresAt<=now())
    || current.project.ownerId!==current.ownerId || !current.owner.emailVerifiedAt || !currentManagedBinding(current))
    throw new AppError('Managed project binding is unavailable.',401,'CONNECTION_TOKEN_INVALID');
}
