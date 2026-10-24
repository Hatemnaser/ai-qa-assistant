import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {atomicJson,privateDirectory,readPrivate,requireCondition} from './lib/private-files.mjs';
import {LocalOperationsLock} from './lib/local-lock.mjs';
import {validateAlertConfig,initialAlertState,updateObservation,observeHealth,sendNotice,acceptedNotice,alertHealthy,ALERT_ATTEMPT_LIMIT,ALERT_ATTEMPT_WINDOW_MS} from './lib/alert-notification.mjs';

export async function monitorAlerts({config,stateDirectory,signal,once=false,observe=observeHealth,send=sendNotice,now=Date.now,emit=e=>console.log(JSON.stringify(e))}={}) {
  validateAlertConfig(config);
  const directory=await privateDirectory(stateDirectory),path=resolve(directory,'status.json');
  const lock=new LocalOperationsLock(resolve(directory,'alerts.lock.sqlite'));
  let owned=false,state;
  const save=async()=>{requireCondition(owned,'ALERT_LOCK_REQUIRED');await lock.check();await atomicJson(path,state,{beforeCommit:()=>requireCondition(owned,'ALERT_LOCK_REQUIRED')});};
  try {
    await lock.connect(); owned=await lock.acquire(); requireCondition(owned,'ALERT_ALREADY_RUNNING');
    let previous;try{previous=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    state=initialAlertState(config,previous,now()); await save();
    do {
      if(signal?.aborted)break;
      updateObservation(state,await observe(config,{now}),now());
      await save(); // Incident/notice exists durably BEFORE network delivery.
      // One admission instant for pruning, the limit and the reservation.
      // No awaited persistence may turn a full budget into a new admission.
      const attemptAt=now();
      requireCondition(Number.isSafeInteger(attemptAt)&&attemptAt>=state.heartbeatAt,'ALERT_CLOCK_REVERSED');
      state.attempts=state.attempts.filter(at=>attemptAt-at<ALERT_ATTEMPT_WINDOW_MS);
      if(state.pending && state.attempts.length>=ALERT_ATTEMPT_LIMIT) {
        // Include ambiguous/rejected attempts; flapping/restarts cannot exhaust
        // the shared provider's allowance by generating a new incident each poll.
        state.nextAttemptAt=Math.max(state.nextAttemptAt,state.attempts[0]+ALERT_ATTEMPT_WINDOW_MS);
        await save();
      } else if(state.pending && attemptAt>=state.nextAttemptAt) {
        // Durable backoff before sending also rate-limits crash/ambiguous ACK retries.
        state.deliveryFailures=Math.min((state.deliveryFailures??0)+1,100);
        state.nextAttemptAt=attemptAt+Math.min(900000,60000*2**Math.min(4,state.deliveryFailures-1));
        state.attempts.push(attemptAt);
        await save();
        try { await send(config,state.pending,{signal});acceptedNotice(state,now());emit({event:'operations_notification',outcome:'SMTP_ACCEPTED'}); }
        catch { emit({event:'operations_notification',outcome:'DELIVERY_UNCONFIRMED'}); }
        state.heartbeatAt=now(); await save();
      }
      if(!once&&!signal?.aborted)await delay(15000,undefined,{signal}).catch(()=>{});
    }while(!once&&!signal?.aborted);
    return state;
  } finally {
    try {if(owned&&state){state.status='STOPPED';state.heartbeatAt=now();await save();}}
    finally {owned=false;await lock.end();}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
  try {
    const [command,...rest]=process.argv.slice(2);requireCondition(!rest.length,'ALERT_USAGE');
    const directory=process.env.ODDPATH_ALERT_STATE_DIRECTORY;
    const config=validateAlertConfig(JSON.parse(await readPrivate(process.env.ODDPATH_ALERT_CONFIG_FILE)));
    if(command==='health') {
      const state=JSON.parse(await readPrivate(resolve(directory,'status.json'),262144));
      initialAlertState(config,state,Date.now());process.exitCode=alertHealthy(state)?0:1;
    }else if(command==='test') {
      await sendNotice(config,{id:randomUUID(),incidentId:randomUUID(),type:'TEST',observedAt:Date.now(),affected:[]},{signal:controller.signal});
      console.log(JSON.stringify({event:'operations_notification_test',outcome:'SMTP_ACCEPTED',inboxDelivery:'UNVERIFIED'}));
    }else {
      requireCondition(['run','once'].includes(command),'ALERT_USAGE');
      const state=await monitorAlerts({config,stateDirectory:directory,signal:controller.signal,once:command==='once'});
      if(state.pending||state.failures.length||state.incident)process.exitCode=1;
    }
  }catch{console.error(JSON.stringify({event:'operations_notification',outcome:'MONITOR_FAILED'}));process.exitCode=1;}
}
