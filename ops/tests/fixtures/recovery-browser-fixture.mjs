import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {DockerRuntimeDriver} from '/opt/oddpath/apps/browser-runtime/src/docker-driver.mjs';
import {RuntimeJournal} from '/opt/oddpath/apps/browser-runtime/src/journal.mjs';
const token=randomBytes(32).toString('hex'),config=JSON.parse(process.env.ODDPATH_ACTIVATION_BROWSER),journal=new RuntimeJournal('/var/lib/oddpath/runtime.sqlite');
const driver=new DockerRuntimeDriver(config);let allocated=false;
try{
 const now=Date.now(),input={executionId:'activation-physical',runtimeId:config.instanceId,projectId:'closed-project',bindingHash:'fixture',allocationOwner:'awaited-creator',token,leaseUntil:now+45000,deadline:now+120000,origins:['https://example.test']};
 journal.reserve(input);await driver.start(input);allocated=true;journal.live(input.executionId,input.allocationOwner);
 fs.writeFileSync('/evidence/browser-ready','READY',{mode:0o600});
 const end=Date.now()+25000;while(!fs.existsSync('/evidence/browser-stop')&&Date.now()<end)await delay(100);
 journal.requestStop(input.executionId);const proof=await driver.stop(input.runtimeId);journal.stopped(input.executionId,proof);journal.reported(input.executionId);allocated=false;
 fs.writeFileSync('/evidence/browser-proof.json',JSON.stringify({status:'STOPPED',proof,creatorFence:journal.get(input.executionId).allocationOwner}),{mode:0o600});
}catch(e){console.error(String(e.message).replaceAll(token,'[REDACTED]'));process.exitCode=1;}
finally{if(allocated)await driver.stop(config.instanceId).catch(()=>{});journal.close();}
