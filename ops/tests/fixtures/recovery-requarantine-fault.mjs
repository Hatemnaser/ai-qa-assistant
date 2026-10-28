// Integration-only barriers around real requarantine SQL; no fake query results.
import {Client} from 'pg';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
if(process.env.ODDPATH_ACTIVATION_TESTS!=='1')throw Error('TEST_ONLY');
const mode=process.env.ODDPATH_REQUARANTINE_TEST_FAULT;
if(!['before-close','after-close-commit','lost-close-ack'].includes(mode))throw Error('TEST_FAULT_INVALID');
const directory=process.env.ODDPATH_RECOVERY_STATE_DIRECTORY;
let closing=false,hit=false;
async function barrier(){
 hit=true;fs.writeFileSync(directory+'/requarantine-ready',mode,{mode:0o600});
 const end=Date.now()+90000;
 while(!fs.existsSync(directory+'/requarantine-release')){
  if(Date.now()>end)throw Error('TEST_BARRIER_TIMEOUT');await delay(30);
 }
}
const query=Client.prototype.query;
Client.prototype.query=async function(sql,...args){
 const closes=this.database==='postgres'&&typeof sql==='string'&&sql.startsWith('ALTER DATABASE "active_')&&sql.endsWith('ALLOW_CONNECTIONS false');
 if(closes){closing=true;if(!hit&&mode==='before-close')await barrier();}
 const value=await query.call(this,sql,...args);
 if(!hit&&closing&&this.database==='postgres'&&sql==='COMMIT'){
  if(mode==='after-close-commit')await barrier();
  if(mode==='lost-close-ack'){hit=true;this.connection.stream.destroy();throw Error('TEST_LOST_REQUARANTINE_COMMIT_ACK');}
 }
 return value;
};
