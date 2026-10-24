import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {monitorAlerts} from '../alerts.mjs';
import {initialAlertState,updateObservation,alertHealthy} from '../lib/alert-notification.mjs';
const config={schemaVersion:1,instance:'budget-regression',maintenanceState:join(tmpdir(),'maintenance.json'),backupState:join(tmpdir(),'backup.json'),backupScope:'FULL_SYSTEM',assets:true,smtp:{host:'synthetic.test',port:587,user:'operator',from:'ops@example.test',to:'owner@example.test',passwordFile:join(tmpdir(),'unused-password')}};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'oddpath-alert-budget-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('crossing the hour during persistence leaves restartable state and does not bypass the rolling budget',async()=>fixture(async dir=>{
 let time=1000000,calls=[];
 const options={config,stateDirectory:dir,once:true,now:()=>time,observe:async()=>({checkedAt:time,failures:['backup']}),send:async(_c,n)=>calls.push(n.id),emit:()=>{}};
 for(let i=0;i<8;i++){time=1000000+i*1000;await monitorAlerts({...options,observe:async()=>({checkedAt:time,failures:i%2?[]:['backup']})});}
 assert.equal(calls.length,8);const deadline=4600000;time=deadline-1;let crossed=false;
 const now=()=>{const stored=JSON.parse(readFileSync(join(dir,'status.json'),'utf8'));if(stored.nextAttemptAt===deadline&&stored.attempts.length===8){time=deadline;crossed=true;}return time;};
 await monitorAlerts({...options,now});assert(crossed,'The persistence window must cross the hour boundary');
 const saved=JSON.parse(await readFile(join(dir,'status.json')));assert(saved.attempts.length<=8,'A normal persisted state must remain valid on restart');
 assert.equal(saved.pending?.type,'FAILURE','Exhausted admission must retain its pending notice');const id=saved.pending.id;
 time=deadline;await monitorAlerts(options);assert.equal(calls.length,9);assert.equal(calls.at(-1),id);
 await monitorAlerts(options);assert.equal(calls.length,9,'Restart must not add another send while eight attempts remain active');
 assert.equal(JSON.parse(await readFile(join(dir,'status.json'))).attempts.length,8);
}));

test('legacy boundary overflow is normalized without losing the incident, pending ID, retry budget or backoff',async()=>fixture(async dir=>{
 const time=4600000,state=initialAlertState(config,undefined,time);
 updateObservation(state,{checkedAt:time,failures:['backup']},time);
 state.attempts=[1000000,...Array.from({length:8},(_,i)=>1001000+i*1000)];
 state.deliveryFailures=3;state.nextAttemptAt=time+120000;state.status='STOPPED';
 await writeFile(join(dir,'status.json'),JSON.stringify(state),{mode:0o600});let calls=[];
 const options={config,stateDirectory:dir,once:true,now:()=>time,observe:async()=>({checkedAt:time,failures:['backup']}),send:async(_c,n)=>calls.push(n.id),emit:()=>{}};
 await monitorAlerts(options);await monitorAlerts(options);let saved=JSON.parse(await readFile(join(dir,'status.json')));
 assert.equal(calls.length,0);assert.deepEqual(saved.attempts,state.attempts.slice(1));assert.deepEqual(saved.pending,state.pending);assert.deepEqual(saved.incident,state.incident);
 assert.equal(saved.deliveryFailures,3);assert.equal(saved.nextAttemptAt,state.nextAttemptAt);assert.equal(alertHealthy(saved,time),false);
 await monitorAlerts({...options,now:()=>state.nextAttemptAt,observe:async()=>({checkedAt:state.nextAttemptAt,failures:['backup']})});
 saved=JSON.parse(await readFile(join(dir,'status.json')));assert.equal(calls.length,1);assert.equal(calls[0],state.pending.id);assert(saved.incident);assert.equal(saved.pending,null);
}));

test('legacy overflow recovery expires only old timestamps, never repairs malformed or over-budget active state',()=>{
 const time=4600000,make=attempts=>({...initialAlertState(config,undefined,time),attempts});
 const input=make([1000000,...Array(8).fill(1000001)]),copy=structuredClone(input);
 assert.equal(initialAlertState(config,input,time).attempts.length,8);assert.deepEqual(input,copy,'Health/startup validation must not mutate the source object');
 assert.equal(initialAlertState(config,make(Array(9).fill(1000000)),time).attempts.length,0);
 for(const bad of [null,Array(9).fill(1000001),Array(10).fill(1000000),[1000000,time+1],[1000001,1000000],[-1],[NaN],['1000000']])assert.throws(()=>initialAlertState(config,make(bad),time),/ALERT_SAVED_DELIVERY_INVALID/);
 assert.throws(()=>initialAlertState(config,make([time]),time-1),/ALERT_SAVED_STATE_INVALID/);
});
