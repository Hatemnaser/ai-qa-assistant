import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jobManifest, successfulCompletion, isHealthy, supervise } from '../maintenance.mjs';
import { atomicJson } from '../lib/private-files.mjs';

const environment = { DATABASE_URL: 'postgresql://synthetic:do-not-log@localhost/test' };
const completed = job => ({ code: 0, stdout: JSON.stringify(job.includes('usage-reconcile') ? {reconciled: 1} : {event:'retention_cleanup',status:'completed'}) });
class FakeClient extends EventEmitter {
  constructor(acquired = true) { super(); this.acquired = acquired; this.ended = false; }
  async connect() {}
  async query(sql) { return {rows: [sql.includes('pg_try_advisory_lock') ? {acquired:this.acquired} : {pending:false}]}; }
  async end() { this.ended = true; this.emit('end'); }
}
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(),'oddpath-ops-test-'));
  try { await fn(dir); } finally { await rm(dir,{recursive:true,force:true}); }
}
test('only existing safe cleanup commands are scheduled; configured deletion survives disabled uploads', () => {
  assert.deepEqual(jobManifest({}).map(j=>j.id),['usage','retention']);
  assert.deepEqual(jobManifest({PRIVATE_ASSETS_ENABLED:'false',R2_ENDPOINT:'x',R2_BUCKET_NAME:'x',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x'}).map(j=>j.id),['usage','retention','assets']);
  assert.throws(()=>jobManifest({R2_ENDPOINT:'x'}),/PARTIAL_ASSET/);
  assert.throws(()=>jobManifest({ODDPATH_OPS_ROLE:'arbitrary-shell'}),/INVALID_ROLE/);
});
test('exit0 alone, disabled cleanup, overlap or malformed output cannot fabricate completion', () => {
  const retention=jobManifest({}).find(j=>j.id==='retention');
  for(const stdout of ['', 'secret error', '{"event":"retention_cleanup","status":"overlap_skipped"}', '{"event":"retention_cleanup","status":"failed"}'])
    assert.equal(successfulCompletion(retention,{code:0,stdout}),false);
  assert.equal(successfulCompletion({id:'assets'},{code:0,stdout:'{"event":"asset_cleanup","status":"disabled_skipped"}'}),false);
  assert.equal(successfulCompletion(retention,{code:1,stdout:'{"event":"retention_cleanup","status":"completed"}'}),false);
});
test('health needs successful jobs, fresh heartbeat and non-stale last success', () => {
  const jobs=jobManifest({}),now=10_000_000;
  const state={schemaVersion:1,status:'RUNNING',heartbeatAt:now,jobs:Object.fromEntries(jobs.map(j=>[j.id,{outcome:'PASS',lastSuccessAt:now}]))};
  assert.equal(isHealthy(state,jobs,now),true);
  assert.equal(isHealthy({...state,heartbeatAt:now-45_000},jobs,now),false);
  assert.equal(isHealthy({...state,heartbeatAt:now+1},jobs,now),false);
  assert.equal(isHealthy({...state,status:'STOPPED'},jobs,now),false);
  for(const job of jobs) assert.equal(isHealthy({...state,jobs:{...state.jobs,[job.id]:{outcome:'FAIL',lastSuccessAt:now}}},jobs,now),false);
  assert.equal(isHealthy({...state,jobs:{}},jobs,now),false);
  state.jobs.usage.lastSuccessAt=0;assert.equal(isHealthy(state,jobs,now),false);
});

const backupEnvironment = { ODDPATH_OPS_ROLE: 'backup' };
const backupCompleted = command => ({code:0,stdout:JSON.stringify(command==='prune'?{expiredRemoved:0}:{status:'ENCRYPTED_BACKUP_VERIFIED',scope:'CLOSED_DATABASE_ONLY'})});

test('failed backup stays unhealthy during restarted retries and only verified success restores health',async()=>fixture(async dir=>{
 const jobs=jobManifest(backupEnvironment),status=async()=>JSON.parse(await readFile(join(dir,'status.json'),'utf8'));
 const run=execute=>supervise({stateDirectory:dir,env:backupEnvironment,once:true,emit:()=>{},execute});
 await run(async(_node,[_file,command])=>backupCompleted(command));
 const successAt=(await status()).jobs.backup.lastSuccessAt;
 await run(async(_node,[_file,command])=>command==='prune'?backupCompleted(command):{code:1,stdout:''});
 assert.equal((await status()).jobs.backup.outcome,'FAIL');
 let retryState;
 await run(async(_node,[_file,command])=>{
   if(command==='prune')return backupCompleted(command);
   retryState=await status();
   return {code:null,signal:'SIGKILL',stdout:''};
 });
 assert.equal(retryState.status,'RUNNING');assert.equal(retryState.jobs.backup.outcome,'RUNNING');
 assert.equal(retryState.jobs.backup.lastSuccessAt,successAt);assert.equal(isHealthy(retryState,jobs),false);
 const later=Date.now()+10_000;assert.equal(isHealthy({...retryState,heartbeatAt:later},jobs,later),false);
 assert.equal((await status()).jobs.backup.outcome,'FAIL');
 let recoveringState;
 const recovered=await run(async(_node,[_file,command])=>{
   if(command==='create')recoveringState=await status();
   return backupCompleted(command);
 });
 assert.equal(isHealthy(recoveringState,jobs),false);
 assert.equal(recovered.jobs.backup.outcome,'PASS');assert.equal(isHealthy({...recovered,status:'RUNNING'},jobs),true);
}));

test('a normal scheduled backup can use a recent success while its next attempt runs',async()=>fixture(async dir=>{
 const run=execute=>supervise({stateDirectory:dir,env:backupEnvironment,once:true,emit:()=>{},execute});
 await run(async(_node,[_file,command])=>backupCompleted(command));
 let running;
 const next=await run(async(_node,[_file,command])=>{
   if(command==='create'){
     running=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));
   }
   return backupCompleted(command);
 });
 assert.equal(running.jobs.backup.outcome,'RUNNING');assert.equal(isHealthy(running,jobManifest(backupEnvironment)),true);assert.equal(next.jobs.backup.outcome,'PASS');
}));

test('legacy failed or ambiguous running state cannot lose failure on upgrade',async()=>fixture(async dir=>{
 const jobs=jobManifest(backupEnvironment),now=Date.now();
 const previous={schemaVersion:1,role:'backup',status:'FAILED',heartbeatAt:now,alerts:[],jobs:Object.fromEntries(jobs.map(j=>[j.id,{outcome:j.id==='backup'?'FAIL':'PASS',lastSuccessAt:now,finishedAt:now}]))};
 const ambiguous={...previous,status:'RUNNING',jobs:{...previous.jobs,backup:{...previous.jobs.backup,outcome:'RUNNING'}}};
 assert.equal(isHealthy(ambiguous,jobs,now),false);
 await writeFile(join(dir,'status.json'),JSON.stringify(previous),{mode:0o600});
 let legacyRetry;
 const recovered=await supervise({stateDirectory:dir,env:backupEnvironment,once:true,emit:()=>{},execute:async(_node,[_file,command])=>{
   if(command==='create')legacyRetry=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));
   return backupCompleted(command);
 }});
 assert.equal(isHealthy(legacyRetry,jobs),false);
 assert.equal(isHealthy({...recovered,status:'RUNNING'},jobs),true);
}));
test('partial job failures persist without raw child output; restart only retries safe commands', async () => fixture(async dir => {
  const emitted=[],first=new FakeClient();
  const one=await supervise({stateDirectory:dir,env:environment,once:true,connect:()=>first,emit:e=>emitted.push(e),execute:async(_node,[file])=>file.includes('usage')?{code:1,stdout:'provider-key-do-not-log'}:completed(file)});
  assert.equal(one.jobs.usage.outcome,'FAIL');assert.equal(one.jobs.retention.outcome,'PASS');assert.ok(first.ended);
  const raw=await readFile(join(dir,'status.json'),'utf8');assert.ok(!raw.includes('provider-key')&&!raw.includes('do-not-log'));
  assert.equal(emitted.length,1);
  const called=[];
  const two=await supervise({stateDirectory:dir,env:environment,once:true,connect:()=>new FakeClient(),emit:()=>{},execute:async(_node,[file])=>{called.push(file);return completed(file);}});
  assert.equal(two.jobs.usage.outcome,'PASS');assert.equal(two.alerts.length,1);assert.equal(called.length,2);
}));
test('the losing instance cannot overwrite the active supervisor state', async () => fixture(async dir => {
  await supervise({stateDirectory:dir,env:environment,once:true,connect:()=>new FakeClient(),emit:()=>{},execute:async(_node,[file])=>completed(file)});
  const before=await readFile(join(dir,'status.json'),'utf8');let calls=0;
  await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>new FakeClient(false),execute:async()=>{calls++;}}),/ALREADY_RUNNING/);
  assert.equal(calls,0);assert.equal(await readFile(join(dir,'status.json'),'utf8'),before);
}));

for (const role of ['backup', 'maintenance']) test(`${role} startup loads the latest failure and alerts after acquiring its lock`,async()=>fixture(async dir=>{
  const env=role==='backup'?backupEnvironment:environment,jobs=jobManifest(env),now=Date.now();
  const affected=role==='backup'?'backup':'usage';
  const old={schemaVersion:1,role,status:'COMPLETED',heartbeatAt:now,alerts:[],jobs:Object.fromEntries(jobs.map(j=>[j.id,{outcome:'PASS',failurePending:false,lastSuccessAt:now-1000,finishedAt:now-1000}]))};
  const failure={event:'operations_failure',job:affected,code:'JOB_FAILED_OR_INCOMPLETE',at:now};
  const latest={...old,status:'FAILED',alerts:[failure],jobs:{...old.jobs,[affected]:{...old.jobs[affected],outcome:'FAIL',failurePending:true,finishedAt:now}}};
  await writeFile(join(dir,'status.json'),JSON.stringify(old),{mode:0o600});
  class Contender extends FakeClient {
    async query(sql){
      if(sql.includes('pg_try_advisory_lock'))await writeFile(join(dir,'status.json'),JSON.stringify(latest),{mode:0o600});
      return super.query(sql);
    }
  }
  let running;
  const recovered=await supervise({stateDirectory:dir,env,once:true,connect:()=>new Contender(),emit:()=>{},execute:async(_node,[file,command])=>{
    if((role==='backup'&&command==='create')||(role==='maintenance'&&file.includes('usage')))running=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));
    return role==='backup'?backupCompleted(command):completed(file);
  }});
  assert.equal(running.jobs[affected].failurePending,true);
  assert.equal(running.jobs[affected].lastSuccessAt,old.jobs[affected].lastSuccessAt);
  assert.deepEqual(running.alerts,[failure]);
  assert.equal(isHealthy(running,jobs),false);
  assert.deepEqual(recovered.alerts,[failure]);
  assert.equal(recovered.jobs[affected].failurePending,false);
}));

test('unreadable locked state is preserved and the acquired client is released',async()=>fixture(async dir=>{
  await writeFile(join(dir,'status.json'),'{}',{mode:0o600});
  class Contender extends FakeClient {
    async query(sql){
      if(sql.includes('pg_try_advisory_lock'))await writeFile(join(dir,'status.json'),'invalid-json',{mode:0o600});
      return super.query(sql);
    }
  }
  const client=new Contender();let calls=0;
  await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async()=>{calls++;}}),SyntaxError);
  assert.equal(calls,0);assert.equal(client.ended,true);
  assert.equal(await readFile(join(dir,'status.json'),'utf8'),'invalid-json');
}));

test('a lock loser neither reads nor replaces the owner state',async()=>fixture(async dir=>{
  await mkdir(join(dir,'status.json'));
  const client=new FakeClient(false);let calls=0;
  await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async()=>{calls++;}}),/ALREADY_RUNNING/);
  assert.equal(calls,0);assert.equal(client.ended,true);
  await assert.rejects(readFile(join(dir,'status.json')),{code:'EISDIR'});
}));
test('connection loss aborts active work, prevents following jobs and leaves terminal failure', async () => fixture(async dir => {
  const client=new FakeClient();let calls=0;
  await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async(_n,_a,{signal})=>{
    calls++;client.emit('error',new Error('private database URL'));assert.equal(signal.aborted,true);throw new Error('child interrupted');
  }}),/DATABASE_LOCK_LOST/);
  const state=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));assert.equal(calls,1);assert.equal(state.status,'FAILED');assert.equal(state.jobs.usage.outcome,'FAIL');assert.ok(!JSON.stringify(state).includes('private database URL'));
}));
test('offline backup supervisor prunes without a PostgreSQL/key dependency and records backup failure',async()=>fixture(async dir=>{
 const called=[];
 const result=await supervise({stateDirectory:dir,env:{ODDPATH_OPS_ROLE:'backup'},once:true,emit:()=>{},execute:async(_node,[_file,command])=>{
   called.push(command);return command==='prune'?{code:0,stdout:'{"expiredRemoved":2}'}:{code:1,stdout:'connection or key unavailable'};
 }});
 assert.deepEqual(called,['prune','create']);assert.equal(result.jobs['backup-retention'].outcome,'PASS');assert.equal(result.jobs.backup.outcome,'FAIL');
}));
test('backup timeout exits the daemon so container restart clears orphaned private tmpfs',async()=>fixture(async dir=>{
 const result=await supervise({stateDirectory:dir,env:{ODDPATH_OPS_ROLE:'backup'},once:true,emit:()=>{},execute:async(_node,[_file,command])=>{
   if(command==='prune')return {code:0,stdout:'{"expiredRemoved":0}'};
   throw Object.assign(new Error('Command exceeded the release verification timeout'),{result:{code:null}});
 }});
 assert.equal(result.status,'FAILED');assert.equal(result.jobs.backup.outcome,'FAIL');
}));
test('backup child SIGKILL is terminal even when execute resolves instead of throwing',async()=>fixture(async dir=>{
 let calls=0;
 const result=await supervise({stateDirectory:dir,env:{ODDPATH_OPS_ROLE:'backup'},once:true,emit:()=>{},execute:async(_node,[_file,command])=>{
   calls++;return command==='prune'?{code:0,signal:null,stdout:'{"expiredRemoved":0}'}:{code:null,signal:'SIGKILL',stdout:''};
 }});
 assert.equal(calls,2);assert.equal(result.status,'FAILED');assert.equal(result.jobs.backup.outcome,'FAIL');
 assert.equal(isHealthy(result,jobManifest({ODDPATH_OPS_ROLE:'backup'})),false);
}));
test('unsuccessful backup completion cannot prove plaintext cleanup and must exit',async()=>fixture(async dir=>{
 const result=await supervise({stateDirectory:dir,env:{ODDPATH_OPS_ROLE:'backup'},once:true,emit:()=>{},execute:async(_node,[_file,command])=>
   command==='prune'?{code:0,stdout:'{"expiredRemoved":0}'}:{code:1,stdout:'private failure that must not be logged'}
 });
 assert.equal(result.status,'FAILED');assert.equal(result.jobs.backup.outcome,'FAIL');
 assert.ok(!(await readFile(join(dir,'status.json'),'utf8')).includes('private failure'));
}));
test('backup execution errors fail closed even without timeout-shaped error metadata',async()=>fixture(async dir=>{
 const result=await supervise({stateDirectory:dir,env:{ODDPATH_OPS_ROLE:'backup'},once:true,emit:()=>{},execute:async(_node,[_file,command])=>{
   if(command==='prune')return {code:0,stdout:'{"expiredRemoved":0}'};
   throw new Error('child cleanup could not complete');
 }});
 assert.equal(result.status,'FAILED');assert.equal(result.jobs.backup.outcome,'FAIL');
}));
test('status persistence failure always closes the client instead of stranding its advisory lock',async()=>fixture(async dir=>{
 const client=new FakeClient();let calls=0;
 await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async(_node,[file])=>{
   calls++;await rm(join(dir,'status.json'));await mkdir(join(dir,'status.json'));return completed(file);
 }}));
 assert.equal(calls,1);assert.equal(client.ended,true);
}));

test('connection lost during startup cannot publish or finalize stale state',async()=>fixture(async dir=>{
 await supervise({stateDirectory:dir,env:environment,once:true,connect:()=>new FakeClient(),emit:()=>{},execute:async(_n,[file])=>completed(file)});
 const before=await readFile(join(dir,'status.json'),'utf8');let calls=0;
 class LostAtAcquisition extends FakeClient {
   async query(sql){const result=await super.query(sql);if(sql.includes('pg_try_advisory_lock'))this.emit('error',new Error('connection lost'));return result;}
 }
 const client=new LostAtAcquisition();
 await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async()=>{calls++;}}),/LOCK_LOST/);
 assert.equal(calls,0);assert.equal(await readFile(join(dir,'status.json'),'utf8'),before);assert.equal(client.ended,true);
}));

test('a late successful child cannot publish completion after connection loss',async()=>fixture(async dir=>{
 const client=new FakeClient();let before,calls=0;
 await assert.rejects(supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async(_n,[file])=>{
   calls++;before=await readFile(join(dir,'status.json'),'utf8');client.emit('error',new Error('lost'));
   return completed(file);
 }}),/LOCK_LOST/);
 const saved=JSON.parse(await readFile(join(dir,'status.json'),'utf8')),prior=JSON.parse(before);
 assert.equal(calls,1);assert.equal(saved.status,'FAILED');assert.equal(saved.jobs.usage.outcome,'FAIL');assert.equal(saved.jobs.usage.failurePending,true);
 assert.equal(saved.jobs.usage.lastSuccessAt,prior.jobs.usage.lastSuccessAt);assert.equal(client.ended,true);
}));

for(const role of ['backup','maintenance'])test(`${role} restart cannot reuse PASS from an interrupted owner`,async()=>fixture(async dir=>{
 const env=role==='backup'?backupEnvironment:environment;
 const execute=async(_n,[file,command])=>role==='backup'?backupCompleted(command):completed(file);
 const prior=await supervise({stateDirectory:dir,env,once:true,connect:()=>new FakeClient(),emit:()=>{},execute});
 // This is the state already published by an owner that died while idle.
 await writeFile(join(dir,'status.json'),JSON.stringify({...prior,status:'RUNNING'}),{mode:0o600});
 const snapshots=[];
 const next=await supervise({stateDirectory:dir,env,once:true,connect:()=>new FakeClient(),emit:()=>{},execute:async(_n,[file,command])=>{
   snapshots.push(JSON.parse(await readFile(join(dir,'status.json'),'utf8')));
   return role==='backup'?backupCompleted(command):completed(file);
 }});
 assert.equal(isHealthy(snapshots[0],jobManifest(env)),false);
 assert.ok(Object.values(snapshots[0].jobs).every(j=>j.failurePending===true));
 assert.equal(isHealthy({...next,status:'RUNNING'},jobManifest(env)),true);
}));

test('a queued heartbeat cannot publish or finalize after connection loss',async t=>fixture(async dir=>{
 t.mock.timers.enable({apis:['setInterval']});
 let workStarted,finishWork,pingStarted,finishPing,before;
 const workReady=new Promise(r=>workStarted=r),workDone=new Promise(r=>finishWork=r);
 const pingReady=new Promise(r=>pingStarted=r),pingDone=new Promise(r=>finishPing=r);
 class SlowPing extends FakeClient {
   async query(sql){if(sql==='SELECT 1'){pingStarted();await pingDone;}return super.query(sql);}
 }
 const client=new SlowPing();
 const run=supervise({stateDirectory:dir,env:environment,once:true,connect:()=>client,emit:()=>{},execute:async(_n,[file])=>{
   before=await readFile(join(dir,'status.json'),'utf8');workStarted();await workDone;return completed(file);
 }});
 const rejection=assert.rejects(run,/LOCK_LOST/);
 await workReady;t.mock.timers.tick(10_000);await pingReady;
 client.emit('error',new Error('lost while ping awaited'));finishPing();finishWork();await rejection;
 const saved=JSON.parse(await readFile(join(dir,'status.json'),'utf8')),prior=JSON.parse(before);
 assert.equal(saved.status,'FAILED');assert.equal(saved.jobs.usage.outcome,'FAIL');assert.equal(saved.jobs.usage.failurePending,true);
 assert.equal(saved.jobs.usage.lastSuccessAt,prior.jobs.usage.lastSuccessAt);assert.equal(client.ended,true);
}));

test('a rejected atomic publication preserves status and removes its private temp file',async()=>fixture(async dir=>{
 const path=join(dir,'status.json');await writeFile(path,'authoritative',{mode:0o600});
 await assert.rejects(atomicJson(path,{stale:true},{beforeCommit:()=>{throw new Error('OPS_DATABASE_LOCK_LOST');}}),/LOCK_LOST/);
 assert.equal(await readFile(path,'utf8'),'authoritative');assert.deepEqual(await readdir(dir),['status.json']);
}));
