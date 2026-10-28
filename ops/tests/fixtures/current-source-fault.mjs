// Guarded integration-only real-PG transport faults. Never copied into images.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Client} from 'pg';
import {pgClient} from '../../backup.mjs';
import {stageCurrentSource} from '../../current-source.mjs';
assert.equal(process.env.ODDPATH_RECOVERY_LOCAL_TESTS,'1');
const mode=process.env.ODDPATH_RECOVERY_TEST_FAULT;
assert.ok(['pause-after-freeze','lost-create-ack','late-source-session'].includes(mode));
let late;
const connect=async()=>{
 const client=await pgClient(),query=client.query.bind(client);
 client.query=async(sql,args)=>{
  if(mode==='late-source-session'&&sql.startsWith('ALTER DATABASE ')){
   late=new Client({database:process.env.ODDPATH_RECOVERY_TEST_SOURCE});await late.connect();
  }
  const value=await query(sql,args);
  if(mode==='pause-after-freeze'&&sql==='COMMIT'){
   fs.writeFileSync('/state/fault-ready','SOURCE_FROZEN',{mode:0o600});
   await query("SELECT pg_sleep(120)");
  }
  if(mode==='lost-create-ack'&&sql.startsWith('CREATE DATABASE ')){
   client.connection.stream.destroy();throw new Error('SYNTHETIC_LOST_CREATE_ACK');
  }
  return value;
 };
 return client;
};
try{
 const result=await stageCurrentSource({source:process.env.ODDPATH_RECOVERY_TEST_SOURCE,target:process.env.ODDPATH_RECOVERY_TEST_TARGET,
  owner:'recovery_owner',stateDirectory:process.env.ODDPATH_RECOVERY_STATE_DIRECTORY,connect});
 console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'EXPECTED_FAULT',activationAuthorized:false}));process.exitCode=1;}
finally{await late?.end().catch(()=>{});}
