import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageCurrentSource,inspectCurrentSource,cancelCurrentSource} from '../current-source.mjs';

for(const invalid of [
 {source:'postgres'}, {source:'template0'}, {source:'template1'}, {source:'oddpath_restore_current26'},
 {source:'oddpath; DROP DATABASE postgres'}, {target:'oddpath'}, {owner:'recovery";GRANT ALL'},
])test('rejects unsafe current-source selection '+JSON.stringify(invalid),async()=>{
 let connected=false;
 await assert.rejects(stageCurrentSource({source:'oddpath',target:'oddpath_restore_current26',owner:'recovery_owner',...invalid,connect:async()=>{connected=true;throw Error('Must not connect');}}),/RECOVERY_/);
 assert.equal(connected,false);
});
test('source closure requires an explicit scoped acknowledgment before filesystem or PG work',async()=>{
 let connected=false;
 await assert.rejects(stageCurrentSource({source:'oddpath',target:'oddpath_restore_current26',owner:'recovery_owner',env:{},connect:async()=>{connected=true;}}),/RECOVERY_SOURCE_ACK_REQUIRED/);
 assert.equal(connected,false);
});
test('new commands never accept an application DATABASE_URL or non-control PG database',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oddpath-current-test-'));
 try{
  const pass=join(dir,'pgpass');await writeFile(pass,'localhost:5432:*:synthetic:never-log',{mode:0o600});
  const env={PGHOST:'localhost',PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'synthetic',PGPASSFILE:pass,PGSSLMODE:'disable'};
  for(const patch of [{DATABASE_URL:'postgresql://private@localhost/live'},{PGDATABASE:'oddpath'}]){
   let connected=false;
   await assert.rejects(inspectCurrentSource({stateDirectory:dir,env:{...env,...patch},connect:async()=>{connected=true;}}),/BACKUP_DEDICATED_CREDENTIALS_REQUIRED|RECOVERY_CONTROL_DATABASE_REQUIRED/);
   assert.equal(connected,false);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('pre-aborted stage cannot connect or close a source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oddpath-current-test-'));
 try{
  const pass=join(dir,'pgpass');await writeFile(pass,'localhost:5432:*:synthetic:never-log',{mode:0o600});
  const env={PGHOST:'localhost',PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'synthetic',PGPASSFILE:pass,PGSSLMODE:'disable',ODDPATH_RECOVERY_SOURCE_ACK:'FREEZE_SOURCE_KEEP_TARGET_QUARANTINED'};
  let connected=false;
  await assert.rejects(stageCurrentSource({source:'oddpath',target:'oddpath_restore_current26',owner:'recovery_owner',stateDirectory:dir,env,signal:AbortSignal.abort(),connect:async()=>{connected=true;}}),/RECOVERY_CONTROL_LOST/);
  assert.equal(connected,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
