import assert from 'node:assert/strict';import {test} from 'node:test';import {hostname} from 'node:os';
import {activateCurrentClosed} from '../recovery-activation.mjs';import {proveRecoveryRuntime} from '../recovery-runtime-proof.mjs';
test('closed activation requires its distinct acknowledgment before opening state or PG',async()=>{
 let connected=false;await assert.rejects(activateCurrentClosed({confirmation:'source',database:'recovered',runtimeRole:'runtime',env:{},connect:async()=>{connected=true;}}),/RECOVERY_CLOSED_ACTIVATION_ACK_REQUIRED/);assert.equal(connected,false);
});
for(const database of ['postgres','template0','oddpath_restore_copy','bad;DROP'])test('closed activation rejects operational name '+database,()=>assert.rejects(activateCurrentClosed({database,runtimeRole:'runtime'}),/RECOVERY_/));
test('runtime proof does not accept missing deployment identities or a written receipt',()=>assert.rejects(proveRecoveryRuntime({env:{ODDPATH_RECOVERY_PROOF:'{"processExited":true}'}}),/RECOVERY_DEPLOYMENT_IDENTITIES_REQUIRED/));
const env={ODDPATH_RECOVERY_POSTGRES_CONTAINER:'pg',ODDPATH_RECOVERY_SUPERVISOR_CONTAINER:'supervisor'};
const identity=()=>({Id:hostname()+'-operator',State:{Running:true}});
async function proof(change){
 const objects={self:identity(),pg:{Id:'postgres-id',State:{Running:true},NetworkSettings:{Networks:{control:{IPAddress:'192.0.2.1'}}}},worker:{Id:'supervisor-id',State:{Running:false,Restarting:false,Paused:false,Pid:0},Mounts:[{Type:'volume',Name:'journal',Source:'/journal',Destination:'/var/lib/oddpath'}]},running:[{Id:'postgres-id',State:'running'},{Id:identity().Id,State:'running'}],networks:[]};
 objects.self.Mounts=[{Type:'volume',Name:'journal',Source:'/journal',Destination:'/recovery-runtime',RW:false}];change(objects);
 return proveRecoveryRuntime({env,query:async()=>({rows:[{address:'192.0.2.1'}]}),get:async p=>p==='/networks'?objects.networks:p==='/containers/json?all=true'?objects.running:p==='/containers/pg/json'?objects.pg:p==='/containers/supervisor/json'?objects.worker:objects.self});
}
for(const [name,change,code] of [
 ['live supervisor',o=>{o.worker.State.Running=true;},'RECOVERY_SUPERVISOR_NOT_DRAINED'],
 ['live API',o=>o.running.push({Id:'api',State:'running'}),'RECOVERY_DEPLOYMENT_NOT_DRAINED'],
 ['stopped but remaining runtime',o=>o.running.push({Id:'old-browser',State:'exited',Labels:{'oddpath.runtime':'1'}}),'RECOVERY_RUNTIME_RESOURCES_REMAIN'],
 ['leftover allocation network',o=>o.networks.push({Labels:{'oddpath.runtime':'1'}}),'RECOVERY_RUNTIME_RESOURCES_REMAIN'],
 ['different PostgreSQL host',o=>{o.pg.NetworkSettings.Networks.control.IPAddress='192.0.2.2';},'RECOVERY_POSTGRES_HOST_MISMATCH'],
 ['unrelated journal volume',o=>{o.self.Mounts[0].Name='historical';},'RECOVERY_CURRENT_JOURNAL_MOUNT_REQUIRED'],
 ['writable operator journal mount',o=>{o.self.Mounts[0].RW=true;},'RECOVERY_CURRENT_JOURNAL_MOUNT_REQUIRED'],
])test('live recovery proof rejects '+name,()=>assert.rejects(proof(change),new RegExp(code)));
