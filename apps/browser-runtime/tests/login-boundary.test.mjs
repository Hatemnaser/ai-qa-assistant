import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { LoginBoundary } from '../src/login-boundary.mjs';
import { RuntimeJournal } from '../src/journal.mjs';
import { signGrant, requireLiveGrant } from '../src/viewer-grants.mjs';

function fixture(){let clock=10000;const boundary=new LoginBoundary({manual:true,deadline:20000,preparationDeadline:14000,executionTimeoutMs:5000,now:()=>clock});return {boundary,setTime(value){clock=value;}};}
it('blocks capture and viewing while human input owns the browser, including handoff',()=>{
  const {boundary:b}=fixture(),epoch=randomUUID();
  assert.equal(b.allowsCdp(),false);assert.equal(b.allowsViewer('LOGIN',epoch),false);
  b.begin(epoch);assert.equal(b.allowsViewer('LOGIN',epoch),true);assert.equal(b.allowsViewer('LOGIN',randomUUID()),false);
  assert.equal(b.allowsViewer('VIEW'),false);assert.equal(b.allowsCdp(),false);
  b.handoff(epoch);assert.equal(b.allowsViewer('LOGIN',epoch),false);assert.equal(b.allowsCdp(),false);
  b.ready(epoch);assert.equal(b.allowsViewer('VIEW'),true);assert.equal(b.allowsCdp(),true);assert.equal(b.allowsViewer('LOGIN',epoch),false);
});
it('cannot renew human authority after its deadline or reopen it after completion',()=>{
  const f=fixture(),epoch=randomUUID();f.boundary.begin(epoch);f.setTime(14000);
  assert.equal(f.boundary.live(),false);assert.throws(()=>f.boundary.handoff(epoch));
  const {boundary:b}=fixture();b.begin(epoch);b.handoff(epoch);b.ready(epoch);assert.throws(()=>b.begin(epoch));
});
it('enforces a separate execution limit without extending the total allocation deadline',()=>{
  const f=fixture(),epoch=randomUUID();f.boundary.begin(epoch);f.boundary.handoff(epoch);f.boundary.ready(epoch);f.setTime(13000);f.boundary.start(epoch);
  assert.equal(f.boundary.executionDeadline,18000);assert.throws(()=>f.boundary.start(epoch));assert.throws(()=>f.boundary.begin(epoch));
  f.setTime(18000);assert.equal(f.boundary.allowsCdp(),false);f.boundary.close();f.setTime(12000);assert.equal(f.boundary.live(),false);
});
it('durably fences execution before login completion and rejects old control cookies after handoff',()=>{
  let clock=10000;const j=new RuntimeJournal(':memory:',()=>clock),runtimeId=randomUUID(),epoch=randomUUID();
  const input={executionId:'manual',runtimeId,token:'t',projectId:'p',bindingHash:'b'.repeat(64),leaseUntil:16000,deadline:20000,manual:{},preparationDeadline:14000};
  const grant={schemaVersion:1,executionId:'manual',runtimeId,ownerId:'o',projectId:'p',bindingHash:input.bindingHash,nonce:randomUUID(),expiresAt:13000,mode:'LOGIN',controlEpoch:epoch};
  try{
    j.reserve(input);j.live('manual');assert.throws(()=>j.markStarted('manual'));assert.throws(()=>requireLiveGrant(grant,j,clock));
    j.loginTransition('manual','PREPARING','LOGIN',epoch);requireLiveGrant(grant,j,clock);assert.throws(()=>j.markStarted('manual'));
    assert.throws(()=>j.loginTransition('manual','LOGIN','READY',randomUUID()));
    j.loginTransition('manual','LOGIN','READY',epoch);assert.throws(()=>requireLiveGrant(grant,j,clock));j.markStarted('manual');assert.throws(()=>j.markStarted('manual'));
  }finally{j.close();}
});
it('checks preparation expiry during durable transitions and rejects unbound login grants',()=>{
  let clock=10000;const j=new RuntimeJournal(':memory:',()=>clock),epoch=randomUUID();
  try{
    j.reserve({executionId:'expiry',runtimeId:randomUUID(),token:'t',projectId:'p',bindingHash:'b',leaseUntil:16000,deadline:20000,manual:{},preparationDeadline:14000});j.live('expiry');
    clock=14000;assert.throws(()=>j.loginTransition('expiry','PREPARING','LOGIN',epoch));assert.throws(()=>j.renew('expiry',19000));
    assert.equal(j.get('expiry').loginPhase,'PREPARING');
    assert.throws(()=>signGrant({mode:'LOGIN'},'a'.repeat(64)));
  }finally{j.close();}
});
