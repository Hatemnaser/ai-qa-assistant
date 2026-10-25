import { browserStateTransferSchema,parseBrowserStorageState } from '@oddpath/qa-execution-contract';
import { sealBrowserState,unsealBrowserState } from '@oddpath/qa-execution-contract/browser-state-crypto';
export async function captureSavedLogin({claimed,client,supervisor,keys}){
  const id=claimed.task.executionId,local=supervisor.requireLiveLease(id),status=await client.runtime(id,'status');
  supervisor.requireLiveLease(id);
  if(!status.saveLoginConsentAt)return;
  const endpoint=await supervisor.driver.endpoint(local.runtime);supervisor.requireLiveLease(id);
  const response=await supervisor.http(endpoint+'/auth/capture',{method:'POST',headers:{authorization:'Bearer '+local.token,'x-oddpath-login-epoch':status.loginEpoch},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Saved login capture failed.');
  const state=parseBrowserStorageState(await response.json(),[new URL(claimed.task.profile.target.baseUrl).origin,...claimed.task.profile.target.authenticationOrigins]);
  const fresh=supervisor.requireLiveLease(id),context={purpose:'CAPTURE',executionId:id,runtimeId:local.runtime,claimId:claimed.claim.claimId,bindingHash:claimed.task.approval.bindingHash,
    controlEpoch:status.loginEpoch,expiresAt:Math.min(Date.now()+15000,fresh.lease,fresh.preparationDeadline)};
  await client.savedState(id,'capture',claimed.claim,{context,packet:sealBrowserState(state,context,keys)});supervisor.requireLiveLease(id);
}
export async function restoreSavedLogin({claimed,client,supervisor,keys}){
  const id=claimed.task.executionId,local=supervisor.requireLiveLease(id),status=await client.runtime(id,'status');
  const transfer=browserStateTransferSchema.parse(await client.savedState(id,'restore',claimed.claim));
  supervisor.requireLiveLease(id);const c=transfer.context;
  if(c.purpose!=='RESTORE'||c.executionId!==id||c.runtimeId!==local.runtime||c.claimId!==claimed.claim.claimId||c.bindingHash!==claimed.task.approval.bindingHash||c.controlEpoch!==status.loginEpoch||c.expiresAt<=Date.now()||c.expiresAt>Math.min(local.lease,local.preparationDeadline))throw new Error('Saved login transfer expired or changed.');
  const state=parseBrowserStorageState(unsealBrowserState(transfer.packet,c,keys),[new URL(claimed.task.profile.target.baseUrl).origin,...claimed.task.profile.target.authenticationOrigins]);
  const endpoint=await supervisor.driver.endpoint(local.runtime);supervisor.requireLiveLease(id);if(c.expiresAt<=Date.now())throw new Error('Saved login transfer expired.');
  const response=await supervisor.http(endpoint+'/auth/restore',{method:'POST',headers:{authorization:'Bearer '+local.token,'content-type':'application/json','x-oddpath-login-epoch':c.controlEpoch},body:JSON.stringify(state),signal:AbortSignal.timeout(10000)});
  if(!response.ok||(await response.json()).phase!=='READY')throw new Error('Saved login restore failed.');
  if(c.expiresAt<=Date.now())throw new Error('Saved login transfer expired.');
  supervisor.requireLiveLease(id);supervisor.journal.loginTransition(id,'PREPARING','LOGIN',c.controlEpoch);supervisor.journal.loginTransition(id,'LOGIN','READY',c.controlEpoch);
  const ack=await client.runtime(id,'login',{runtimeId:local.runtime,controlEpoch:c.controlEpoch,phase:'READY'},claimed.claim);
  if(ack.state!=='LIVE')throw new Error('Saved login revoked.');return {completed:true,epoch:c.controlEpoch};
}
