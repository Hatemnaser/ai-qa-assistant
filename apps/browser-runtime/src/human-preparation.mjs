import { setTimeout as delay } from 'node:timers/promises';
import { preparationDiagnostic } from './preparation-failure.mjs';

export async function waitForHumanPreparation({ claimed, client, supervisor, journal, capture = async()=>{}, stopping = () => false, heartbeatIntervalMs = 4000, pollIntervalMs = 300 }) {
  const executionId = claimed.task.executionId;
  let pending, failure, preparationFailed=false;
  const renew = async () => {
    const receipt = await client.heartbeat(executionId, claimed.claim);
    const state = await client.runtime(executionId, 'status');
    if (state.state !== 'LIVE') throw new Error('Human preparation stopped.');
    await supervisor.renew(executionId, new Date(receipt.leaseExpiresAt).getTime());
    claimed.claim.leaseExpiresAt = receipt.leaseExpiresAt;
  };
  const heartbeat = setInterval(() => {
    if (pending || failure) return;
    pending = renew().catch(error => { failure = error; return supervisor.stop(executionId).catch(() => {}); }).finally(() => { pending = undefined; });
  }, heartbeatIntervalMs);
  try {
    while (!stopping() && !failure) {
      const local = supervisor.requireLiveLease(executionId);
      const state = await client.runtime(executionId, 'status');
      if (state.state !== 'LIVE' || !state.loginEpoch || !state.loginDeadlineAt) throw new Error('Human preparation is unavailable.');
      if (state.loginPhase === 'ENTER_REQUESTED') {
        await supervisor.login(executionId, 'begin', state.loginEpoch);
        const ack = await client.runtime(executionId, 'login', { runtimeId: local.runtime, controlEpoch: state.loginEpoch, phase: 'LOGIN' }, claimed.claim);
        if (ack.state !== 'LIVE') throw new Error('Human preparation stopped.');
      } else if (state.loginPhase === 'FINISH_REQUESTED') {
        await supervisor.login(executionId, 'complete', state.loginEpoch);
        if(state.saveLoginConsentAt)await capture();
        const ack = await client.runtime(executionId, 'login', { runtimeId: local.runtime, controlEpoch: state.loginEpoch, phase: 'READY' }, claimed.claim);
        if (ack.state !== 'LIVE') throw new Error('Human preparation stopped.');
        return { completed: true, epoch: state.loginEpoch };
      } else if (state.loginPhase === 'READY' && journal.get(executionId)?.loginPhase === 'READY') return { completed: true, epoch: state.loginEpoch };
      else if (!['WAITING','LOGIN'].includes(state.loginPhase)) throw new Error('Human preparation state changed.');
      await delay(pollIntervalMs);
    }
    throw new Error('Human preparation stopped.');
  } catch(error) {
    preparationFailed=true;
    const reason=preparationDiagnostic(error).reason;
    // A heartbeat denial can itself close the browser. Keep that known denial
    // instead of its secondary disconnection, without replacing a concrete
    // preparation error with the cleanup/renewal failure it caused.
    if(failure&&['UNAVAILABLE','BROWSER_CLOSED','AUTHORITY_LOST'].includes(reason))throw failure;
    throw error;
  } finally {
    clearInterval(heartbeat); if (pending) await pending;
    // Stop after a preparation error also ends its lease. Preserve that first
    // error; authority checks still guard every otherwise successful handoff.
    if(!preparationFailed){
      if (failure || stopping()) throw new Error('Human preparation lost authority.');
      supervisor.requireLiveLease(executionId);
    }
  }
}
