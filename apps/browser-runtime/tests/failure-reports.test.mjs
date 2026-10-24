import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { executionFailureV1Schema } from '@oddpath/qa-execution-contract';
import { RuntimeJournal } from '../src/journal.mjs';
import { DatabaseSync } from 'node:sqlite';
import { deferPreparationFailure, retryFailureReports } from '../src/failure-reports.mjs';

const claim = () => ({ task: { executionId: 'execution', projectId: 'project', deadlineAt: new Date(Date.now()+60000).toISOString() },
  claim: { claimId: 'claim', leaseToken: 'sensitive-lease' } });
const fixture = () => {
  const journal = new RuntimeJournal(':memory:'), messages=[];
  const logger = { error: message => messages.push(message) };
  return { journal, logger, messages };
};

it('submits the strict failure contract and a stable non-secret idempotency key', async () => {
  const f=fixture(), claimed=claim();
  try {
    deferPreparationFailure(f.journal,claimed);const [first]=f.journal.pendingFailures();
    deferPreparationFailure(f.journal,claimed);assert.equal(f.journal.pendingFailures().length,1);
    const calls=[];
    await retryFailureReports({...f,projects:[{projectId:'project',client:{async fail(...args){calls.push(args);return {executionId:'execution',status:'FAILED'};}}}]});
    const [id,lease,failure,key]=calls[0];
    assert.equal(id,'execution');assert.deepEqual(lease,{claimId:'claim',leaseToken:'sensitive-lease'});
    assert.deepEqual(executionFailureV1Schema.parse(failure),failure);
    assert.equal(key,first.idempotencyKey);assert.ok(!key.includes(lease.leaseToken));
    assert.equal(f.journal.pendingFailures().length,0);assert.deepEqual(f.messages,[]);
  } finally { f.journal.close(); }
});

it('recovers an ambiguous delivered receipt after journal reopen without executing browser work',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'failure-report-')),path=join(directory,'runtime.sqlite');
  let journal=new RuntimeJournal(path);const messages=[],keys=[];let delivered=false,mutations=0;
  const client={async fail(id,_lease,_failure,key){keys.push(key);if(!delivered){delivered=true;mutations++;throw new Error('Response lost after commit');}return {executionId:id,status:'FAILED'};}};
  try{
    deferPreparationFailure(journal,claim());await retryFailureReports({journal,projects:[{projectId:'project',client}],logger:{error:m=>messages.push(m)}});
    assert.equal(journal.pendingFailures().length,1);journal.close();journal=new RuntimeJournal(path);
    await retryFailureReports({journal,projects:[{projectId:'project',client}],logger:{error:m=>messages.push(m)}});
    assert.equal(mutations,1);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(journal.pendingFailures().length,0);
    assert.match(messages[0],/retained/);assert.ok(!messages.join(' ').includes('sensitive-lease'));
  }finally{journal.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
});

it('retains unconfirmed validation/transport failures and never labels a mismatched receipt successful',async()=>{
  const f=fixture();try{
    deferPreparationFailure(f.journal,claim());
    for(const fail of [async()=>{throw Object.assign(new Error('bad'),{status:400});},async()=>({executionId:'other',status:'FAILED'}),async()=>({executionId:'execution',status:'SUCCEEDED'})]){
      await retryFailureReports({...f,projects:[{projectId:'project',client:{fail}}]});assert.equal(f.journal.pendingFailures().length,1);
    }
    assert.equal(f.messages.length,3);assert.ok(f.messages.every(m=>m.includes('unconfirmed')));
  }finally{f.journal.close();}
});

it('reports authority loss explicitly and removes the expired credential without claiming terminal success',async()=>{
  for(const error of [Object.assign(new Error('revoked'),{status:401}),Object.assign(new Error('lease ended'),{code:'QA_EXECUTION_LEASE_LOST'})]){
    const f=fixture();try{
      deferPreparationFailure(f.journal,claim());
      await retryFailureReports({...f,projects:[{projectId:'project',client:{async fail(){throw error;}}}]});
      assert.equal(f.journal.pendingFailures().length,0);assert.match(f.messages[0],/unconfirmed.*reconciliation required/);
    }finally{f.journal.close();}
  }
});

it('does not retain missing-project reporting credentials beyond the execution deadline',async()=>{
  const f=fixture(),claimed=claim();try{
    deferPreparationFailure(f.journal,claimed);await retryFailureReports({...f,projects:[]});
    assert.equal(f.journal.pendingFailures().length,1);
    await retryFailureReports({...f,projects:[],now:()=>new Date(claimed.task.deadlineAt).getTime()});
    assert.equal(f.journal.pendingFailures().length,0);assert.match(f.messages.at(-1),/unconfirmed.*reconciliation required/);
  }finally{f.journal.close();}
});

it('terminal receipt acknowledgement does not fabricate physical exit or clear a creator fence',async()=>{
  const f=fixture();try{
    f.journal.reserve({executionId:'execution',runtimeId:'runtime',leaseUntil:Date.now()+30000,deadline:Date.now()+60000,token:'runtime-token',projectId:'project',bindingHash:'binding',allocationOwner:'creator'});
    f.journal.requestStop('execution');deferPreparationFailure(f.journal,claim());
    await retryFailureReports({...f,projects:[{projectId:'project',client:{async fail(id){return {executionId:id,status:'FAILED'};}}}]});
    const row=f.journal.get('execution');assert.equal(row.state,'STOPPING');assert.equal(row.allocationOwner,'creator');assert.equal(row.reported,0);assert.equal(row.proof,null);
  }finally{f.journal.close();}
});

it('opens a pre-fix journal without losing its live allocation, creator fence or exit history',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'report-journal-upgrade-')),path=join(directory,'runtime.sqlite');
  let journal=new RuntimeJournal(path);
  try{
    journal.reserve({executionId:'old',runtimeId:'old-runtime',leaseUntil:Date.now()+30000,deadline:Date.now()+60000,token:'old-runtime-token',projectId:'project',bindingHash:'binding',allocationOwner:'old-creator'});
    journal.requestStop('old');const before={...journal.get('old')};journal.close();
    const prior=new DatabaseSync(path);prior.exec('DROP TABLE failure_reports');prior.close();
    journal=new RuntimeJournal(path);assert.deepEqual({...journal.get('old')},before);assert.deepEqual(journal.pendingFailures(),[]);
    deferPreparationFailure(journal,claim());assert.equal(journal.pendingFailures().length,1);
    assert.equal(journal.get('old').allocationOwner,'old-creator');assert.equal(journal.get('old').state,'STOPPING');
  }finally{journal.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
});
