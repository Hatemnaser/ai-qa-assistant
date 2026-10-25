import assert from 'node:assert/strict';
import {it} from 'node:test';
import {waitForHumanPreparation} from '../src/human-preparation.mjs';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
it('does not hand a completed login to execution when a pending heartbeat loses authority',async()=>{
  const entered=deferred(),release=deferred();let stopped=false,ready=false;
  const claimed={task:{executionId:'manual'},claim:{}},journal={get:()=>({loginPhase:ready?'READY':'LOGIN'})};
  const supervisor={requireLiveLease(){if(stopped)throw Error('Stopped');return {runtime:'runtime'};},async stop(){stopped=true;},async renew(){throw Error('Renew must not run after API heartbeat failure');}};
  const client={async heartbeat(){entered.resolve();await release.promise;throw Error('Lease lost');},async runtime(){return {state:'LIVE',loginEpoch:'epoch',loginDeadlineAt:'future',loginPhase:ready?'READY':'LOGIN'};}};
  const result=waitForHumanPreparation({claimed,client,supervisor,journal,heartbeatIntervalMs:5,pollIntervalMs:1});
  await entered.promise;ready=true;await new Promise(r=>setTimeout(r,10));release.resolve();
  await assert.rejects(result,/lost authority/);assert.equal(stopped,true);
});
it('does not acknowledge or return a handoff if owner Stop wins during physical completion',async()=>{
  let stopped=false,acknowledged=false;
  await assert.rejects(waitForHumanPreparation({claimed:{task:{executionId:'manual'},claim:{}},journal:{},
    supervisor:{requireLiveLease(){if(stopped)throw Error('Stopped');return {runtime:'runtime'};},async login(){stopped=true;throw Error('Stopped');}},
    client:{async runtime(_id,action){if(action==='login')acknowledged=true;return {state:'LIVE',loginEpoch:'epoch',loginDeadlineAt:'future',loginPhase:'FINISH_REQUESTED'};}},
    heartbeatIntervalMs:500,pollIntervalMs:1}),/Stopped/);
  assert.equal(acknowledged,false);
});
