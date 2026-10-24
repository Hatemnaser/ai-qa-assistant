import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {monitorAlerts} from '../alerts.mjs';
import {validateAlertConfig,initialAlertState,updateObservation,acceptedNotice,alertHealthy,noticeMessage,observeHealth} from '../lib/alert-notification.mjs';
import {jobManifest} from '../maintenance.mjs';
const config={schemaVersion:1,instance:'synthetic',maintenanceState:join(tmpdir(),'maintenance.json'),backupState:join(tmpdir(),'backup.json'),backupScope:'FULL_SYSTEM',assets:true,smtp:{host:'smtp.example.test',port:587,user:'operator',from:'ops@example.test',to:'owner@example.test',passwordFile:join(tmpdir(),'smtp-password')}};
const start=()=>initialAlertState(config,undefined,1000000);
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'oddpath-alerts-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('config rejects header/URL credentials, query secrets, bad scope and incomplete SMTP',()=>{
 assert.equal(validateAlertConfig(config),config);
 for(const change of [{instance:'bad\r\nBcc:'},{backupScope:'ignore-assets'},{assets:undefined},{apiReadyUrl:'https://user:secret@host/api/health/ready'},{apiReadyUrl:'https://host/api/health/ready?secret=x'},{smtp:{...config.smtp,to:'owner@example.test\r\nBcc: third@example.test'}}])assert.throws(()=>validateAlertConfig({...config,...change}));
});
test('healthy startup emits no notification; health requires a fresh completed scan',()=>{
 const state=start();assert.equal(alertHealthy(state,1000000),false);
 updateObservation(state,{checkedAt:1000001,failures:[]},1000001);assert.equal(state.pending,null);assert.equal(alertHealthy(state,1000001),true);
 assert.equal(alertHealthy(state,1045001),false);assert.equal(alertHealthy(state,1000000),false);
});
test('an unresolved incident never becomes healthy merely because the latest observation recovers',()=>{
 const state=start();updateObservation(state,{checkedAt:1000001,failures:['backup']},1000001);
 const id=state.pending.id;updateObservation(state,{checkedAt:1000002,failures:[]},1000002);
 assert.equal(state.pending.id,id);assert.equal(state.pending.type,'FAILURE');assert.equal(alertHealthy(state,1000002),false);
 acceptedNotice(state,1000003);updateObservation(state,{checkedAt:1000004,failures:[]},1000004);
 assert.equal(state.pending.type,'RECOVERY');acceptedNotice(state,1000005);assert.equal(alertHealthy(state,1000005),true);
});
test('confirmed incident deduplicates, new affected checks notify and reminders are bounded to six hours',()=>{
 const state=start();updateObservation(state,{checkedAt:1000001,failures:['backup']},1000001);acceptedNotice(state,1000002);
 updateObservation(state,{checkedAt:1000003,failures:['backup']},1000003);assert.equal(state.pending,null);
 updateObservation(state,{checkedAt:1000004,failures:['backup','maintenance']},1000004);assert.equal(state.pending.type,'FAILURE');acceptedNotice(state,1000005);
 updateObservation(state,{checkedAt:1000005+6*3600000-1,failures:['backup']},1000005+6*3600000-1);assert.equal(state.pending,null);
 updateObservation(state,{checkedAt:1000005+6*3600000,failures:['backup']},1000005+6*3600000);assert.equal(state.pending.type,'REMINDER');
});
test('unconfirmed recovery is replaced by failure on relapse, even if SMTP may have accepted it',()=>{
 const state=start();updateObservation(state,{checkedAt:1000001,failures:['backup']},1000001);acceptedNotice(state,1000002);
 updateObservation(state,{checkedAt:1000003,failures:[]},1000003);assert.equal(state.pending.type,'RECOVERY');
 updateObservation(state,{checkedAt:1000004,failures:['backup']},1000004);assert.equal(state.pending?.type,'FAILURE');assert.equal(state.incident.resolvedAt,null);
});
test('notification payload contains fixed operational labels only',()=>{
 const state=start();updateObservation(state,{checkedAt:1000001,failures:['backup']},1000001);
 const message=JSON.stringify(noticeMessage(config,state.pending));assert.match(message,/backup/);assert(!message.includes(config.smtp.host));assert(!message.includes(config.smtp.passwordFile));assert(!message.includes(config.maintenanceState));
 assert.throws(()=>noticeMessage(config,{...state.pending,affected:['password=secret']}));
});
test('SMTP rejection is durable across restart, retry is rate-limited, Message-ID stays stable and recovery is delivered',async()=>fixture(async dir=>{
 let time=1000000,calls=[],fail=true,current=['backup'];
 const options={config,stateDirectory:dir,once:true,now:()=>time,observe:async()=>({checkedAt:time,failures:current}),emit:()=>{},send:async(_config,notice)=>{calls.push({...notice});if(fail)throw Error('synthetic SMTP password must never be logged');}};
 const first=await monitorAlerts(options);assert.equal(calls.length,1);assert(first.pending);assert.equal(first.nextAttemptAt,time+60000);
 time+=1;await monitorAlerts(options);assert.equal(calls.length,1);
 time+=60000;fail=false;await monitorAlerts(options);assert.equal(calls.length,2);assert.equal(calls[0].id,calls[1].id);
 time+=1;await monitorAlerts(options);assert.equal(calls.length,2);
 current=[];time+=1;await monitorAlerts(options);assert.equal(calls[2].type,'RECOVERY');
 const saved=JSON.parse(await readFile(join(dir,'status.json')));assert.equal(saved.incident,null);assert.equal(saved.pending,null);assert(!JSON.stringify(saved).includes('password'));
}));
test('competing monitor cannot overwrite state or send mail while owner is sending',async()=>fixture(async dir=>{
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const options={config,stateDirectory:dir,once:true,observe:async()=>({checkedAt:Date.now(),failures:['backup']}),emit:()=>{}};
 const first=monitorAlerts({...options,send:async()=>{entered();await gate;}});await ready;
 const before=await readFile(join(dir,'status.json'),'utf8');
 await assert.rejects(monitorAlerts({...options,send:async()=>assert.fail('second owner sent')}),/ALERT_ALREADY_RUNNING/);
 assert.equal(await readFile(join(dir,'status.json'),'utf8'),before);release();await first;
}));
test('flapping and restarts cannot exceed eight automatic send attempts per rolling hour',async()=>fixture(async dir=>{
 let time=1000000,calls=0,current=[];
 const options={config,stateDirectory:dir,once:true,now:()=>time,observe:async()=>({checkedAt:time,failures:current}),emit:()=>{},send:async()=>{calls++;}};
 for(let i=0;i<12;i++){current=i%2===0?['backup']:[];time++;await monitorAlerts(options);}
 assert.equal(calls,8);let saved=JSON.parse(await readFile(join(dir,'status.json')));assert(saved.pending);assert.equal(saved.attempts.length,8);assert.equal(saved.nextAttemptAt,1000001+3600000);
 time=saved.nextAttemptAt;await monitorAlerts(options);assert.equal(calls,9);saved=JSON.parse(await readFile(join(dir,'status.json')));assert.equal(saved.attempts.length,8);
}));
test('configuration change, corrupt state and reversed clock fail closed',async()=>fixture(async dir=>{
 await monitorAlerts({config,stateDirectory:dir,once:true,now:()=>1000000,observe:async()=>({checkedAt:1000000,failures:[]})});
 await assert.rejects(monitorAlerts({config:{...config,assets:false},stateDirectory:dir,once:true}),/ALERT_SAVED_STATE_INVALID/);
 await assert.rejects(monitorAlerts({config,stateDirectory:dir,once:true,now:()=>999999}),/ALERT_SAVED_STATE_INVALID/);
 await writeFile(join(dir,'status.json'),'{invalid');await assert.rejects(monitorAlerts({config,stateDirectory:dir,once:true}));
}));
test('actual private status files protect full-scope jobs, unresolved retries, assets and stale heartbeat',async()=>fixture(async dir=>{
 const time=Date.now(),local={...config,maintenanceState:join(dir,'maintenance.json'),backupState:join(dir,'backup.json')};
 const state=(role,env)=>({schemaVersion:1,role,status:'RUNNING',heartbeatAt:time,jobs:Object.fromEntries(jobManifest(env).map(j=>[j.id,{outcome:'PASS',failurePending:false,lastSuccessAt:time}]))});
 const maintenance=state('maintenance',{R2_ENDPOINT:'x',R2_BUCKET_NAME:'x',R2_ACCESS_KEY_ID:'x',R2_SECRET_ACCESS_KEY:'x'}),backup=state('backup',{ODDPATH_OPS_ROLE:'backup',ODDPATH_BACKUP_SCOPE:'FULL_SYSTEM'});
 const write=async()=>{await writeFile(local.maintenanceState,JSON.stringify(maintenance),{mode:0o600});await writeFile(local.backupState,JSON.stringify(backup),{mode:0o600});};
 await write();assert.deepEqual((await observeHealth(local,{now:()=>time})).failures,[]);
 backup.jobs['backup-full']={outcome:'RUNNING',failurePending:true,lastSuccessAt:time};await write();assert.deepEqual((await observeHealth(local,{now:()=>time})).failures,['backup']);
 backup.jobs.backup={outcome:'PASS',lastSuccessAt:time};delete backup.jobs['backup-full'];maintenance.jobs.assets.outcome='FAIL';await write();assert.deepEqual((await observeHealth(local,{now:()=>time})).failures,['maintenance','backup']);
 backup.jobs['backup-full']={outcome:'PASS',lastSuccessAt:time};maintenance.jobs.assets.outcome='PASS';await write();assert.deepEqual((await observeHealth(local,{now:()=>time+45000})).failures,['maintenance','backup']);
}));
test('real HTTP readiness rejects redirect, wrong body, 503 and oversized content',async()=>fixture(async dir=>{
 let status=200,body=JSON.stringify({service:'oddpath-api',status:'ready',checks:{database:'ok'}}),requests=0;
 const server=createServer((_req,res)=>{requests++;res.writeHead(status,{Location:'/api/health/ready'});res.end(body);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const local={...config,apiReadyUrl:`http://127.0.0.1:${server.address().port}/api/health/ready`};
 try {
  assert(!(await observeHealth(local)).failures.includes('api'));
  for(const pair of [[302,''],[503,body],[200,'{}'],[200,'x'.repeat(3000)]]){[status,body]=pair;assert((await observeHealth(local)).failures.includes('api'));}
  assert.equal(requests,5);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}));
