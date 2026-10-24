import assert from 'node:assert/strict';
import {it} from 'node:test';
import {randomUUID} from 'node:crypto';
import {RuntimeJournal} from '../src/journal.mjs';
import {BrowserSupervisor} from '../src/supervisor.mjs';
import {deferPreparationFailure} from '../src/failure-reports.mjs';
import {preparationStep,preparationDiagnostic,preparationErrorFromResponse,logPreparationFailure} from '../src/preparation-failure.mjs';
import {waitForHumanPreparation} from '../src/human-preparation.mjs';

const network={stage:'NAVIGATION',reason:'NETWORK_TIMEOUT'};
async function rejectedLogin(body){
 const now=Date.now(),journal=new RuntimeJournal(':memory:',()=>now),stops=[];
 const task={executionId:'failed-login',projectId:'project',deadlineAt:new Date(now+600000).toISOString(),approval:{bindingHash:'b'.repeat(64)},profile:{authentication:{kind:'MANUAL'},target:{baseUrl:'https://example.test',resourceOrigins:[],authenticationOrigins:[]},executionLimits:{preparationTimeoutMs:300000,executionTimeoutMs:600000}}};
 const driver={async start(){},async endpoint(){return 'http://runtime';},async stop(runtime){stops.push(runtime);return {processExited:true,observedAt:now};}};
 const supervisor=new BrowserSupervisor({journal,driver,now:()=>now,fetch:async()=>Response.json(body,{status:409})});
 await supervisor.allocate(task,now+45000);let error;
 try{await supervisor.login(task.executionId,'begin',randomUUID());}catch(caught){error=caught;}
 assert.ok(error);return {journal,task,error,stops};
}

it('keeps the safe navigation cause across rejected runtime HTTP and physical Stop',async()=>{
 const f=await rejectedLogin({failure:network});try{
  assert.deepEqual(f.error.preparationFailure,network);
  assert.equal(f.journal.get(f.task.executionId).state,'STOPPED');assert.equal(f.stops.length,1);
 }finally{f.journal.close();}
});

it('persists the safe preparation reason in the existing strict failure receipt',()=>{
 const journal=new RuntimeJournal(':memory:');try{
  const claimed={task:{executionId:'failed-login',projectId:'project',deadlineAt:new Date(Date.now()+60000).toISOString()},claim:{claimId:'claim',leaseToken:'synthetic-secret'}};
  const error=Object.assign(new Error('sensitive content must not be sent'),{preparationFailure:network});
  deferPreparationFailure(journal,claimed,error);
  const row=journal.pendingFailures()[0],failure=JSON.parse(row.failure);
  assert.equal(failure.code,'BROWSER_SESSION_UNAVAILABLE');assert.equal(failure.message,'Target navigation timed out.');
  assert.ok(!row.failure.includes('sensitive content'));
  deferPreparationFailure(journal,claimed,Object.assign(new Error('other'),{preparationFailure:{stage:'INPUT',reason:'INPUT_UNCONFIRMED'}}));
  assert.equal(journal.pendingFailures()[0].failure,row.failure,'First receipt/key stays immutable across later reports');
 }finally{journal.close();}
});

it('rejects untrusted diagnostic fields without copying raw errors into the supervisor',async()=>{
 const f=await rejectedLogin({failure:{...network,message:'password=secret',url:'https://example.test/?token=secret'}});try{
  assert.deepEqual(f.error.preparationFailure,{stage:'UNKNOWN',reason:'UNAVAILABLE'});
  assert.ok(!JSON.stringify(f.error).includes('secret'));assert.equal(f.journal.get(f.task.executionId).state,'STOPPED');
 }finally{f.journal.close();}
});

it('classifies navigation failure without retaining URL, tokens, content or an unsafe cause',async()=>{
 let error;try{await preparationStep('NAVIGATION',async()=>{throw new Error('page.goto: net::ERR_TIMED_OUT at https://private.test/login?token=secret-password');});}catch(caught){error=caught;}
 assert.deepEqual(error.preparationFailure,network);assert.equal(error.message,'Target navigation timed out.');
 assert.ok(!JSON.stringify(error).includes('private.test'));assert.ok(!String(error.stack).includes('secret-password'));assert.equal(error.cause,undefined);
});

it('distinguishes CDP timeout, input failure and authority loss with only fixed values',()=>{
 assert.deepEqual(preparationDiagnostic(Object.assign(new Error('sensitive details'),{name:'TimeoutError'}),'CDP'),{stage:'CDP',reason:'TIMEOUT'});
 assert.deepEqual(preparationDiagnostic(new Error('sensitive command stdout'),'INPUT'),{stage:'INPUT',reason:'INPUT_UNCONFIRMED'});
 assert.equal(preparationDiagnostic(Object.assign(new Error('secret'),{code:'QA_EXECUTION_LEASE_LOST'})).reason,'AUTHORITY_LOST');
});

it('cancels an oversized runtime error body and rejects malformed or unsupported diagnostics',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(2048)));},cancel(){cancelled=true;}}),{status:409});
 const error=await preparationErrorFromResponse(response);assert.equal(cancelled,true);assert.deepEqual(error.preparationFailure,{stage:'UNKNOWN',reason:'UNAVAILABLE'});
 for(const body of [{failure:{stage:'NAVIGATION',reason:'__proto__'}},{failure:{stage:'NAVIGATION',reason:{password:'secret'}}},{failure:{stage:'OTHER',reason:'NETWORK_TIMEOUT'}},null]){
  const safe=await preparationErrorFromResponse(Response.json(body,{status:409}));assert.deepEqual(safe.preparationFailure,{stage:'UNKNOWN',reason:'UNAVAILABLE'});assert.ok(!JSON.stringify(safe).includes('secret'));
 }
});

it('logs only validated diagnostic fields and cannot interrupt cleanup if the logging sink fails',()=>{
 const messages=[],error=Object.assign(new Error('password=secret'),{preparationFailure:network});
 logPreparationFailure({error:value=>messages.push(value)},'safe-execution',error);
 assert.deepEqual(JSON.parse(messages[0]),{event:'BROWSER_PREPARATION_FAILURE',...network,executionId:'safe-execution'});
 logPreparationFailure({error:value=>messages.push(value)},'https://private.test/?secret',error);
 assert.ok(!messages.join('').includes('secret'));assert.equal(JSON.parse(messages[1]).executionId,undefined);
 assert.doesNotThrow(()=>logPreparationFailure({error(){throw Error('logging failed');}},'safe-execution',error));
});

it('does not overwrite the original preparation error with the lease loss caused by stopping it',async()=>{
 const original=Object.assign(new Error('Target navigation timed out.'),{preparationFailure:network});let stopped=false,acknowledged=false;
 await assert.rejects(waitForHumanPreparation({claimed:{task:{executionId:'execution'},claim:{}},journal:{},
  supervisor:{requireLiveLease(){if(stopped)throw Error('Runtime lease lost.');return {runtime:'runtime'};},async login(){stopped=true;throw original;}},
  client:{async runtime(_id,action){if(action==='login')acknowledged=true;return {state:'LIVE',loginEpoch:randomUUID(),loginDeadlineAt:'future',loginPhase:'ENTER_REQUESTED'};}},
  heartbeatIntervalMs:1000,pollIntervalMs:1}),error=>error===original);
 assert.equal(stopped,true);assert.equal(acknowledged,false);
});

it('drains a racing failed heartbeat without masking an already failed preparation or acknowledging READY',async()=>{
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
 const entered=deferred(),releaseLogin=deferred(),releaseHeartbeat=deferred();let stopped=false,acknowledged=false;
 const original=Object.assign(new Error('Target navigation timed out.'),{preparationFailure:network});
 const outcome=waitForHumanPreparation({claimed:{task:{executionId:'execution'},claim:{}},journal:{},
  supervisor:{requireLiveLease(){if(stopped)throw Error('Runtime lease lost.');return {runtime:'runtime'};},async login(){await releaseLogin.promise;stopped=true;throw original;},async stop(){stopped=true;}},
  client:{async heartbeat(){entered.resolve();await releaseHeartbeat.promise;throw Error('Lease lost');},async runtime(_id,action){if(action==='login')acknowledged=true;return {state:'LIVE',loginEpoch:randomUUID(),loginDeadlineAt:'future',loginPhase:'ENTER_REQUESTED'};}},
  heartbeatIntervalMs:5,pollIntervalMs:1}).then(value=>({value}),error=>({error}));
 await entered.promise;releaseLogin.resolve();await new Promise(r=>setImmediate(r));releaseHeartbeat.resolve();
 assert.equal((await outcome).error,original);assert.equal(stopped,true);assert.equal(acknowledged,false);
});

it('keeps a known heartbeat denial when its Stop only causes a secondary browser disconnection',async()=>{
 let release;const closed=new Promise(r=>{release=r;}),denied=Object.assign(new Error('Lease denied'),{code:'QA_EXECUTION_LEASE_LOST'});let acknowledged=false;
 const result=waitForHumanPreparation({claimed:{task:{executionId:'execution'},claim:{}},journal:{},
  supervisor:{requireLiveLease(){return {runtime:'runtime'};},async login(){await closed;throw new Error('fetch failed');},async stop(){release();}},
  client:{async heartbeat(){throw denied;},async runtime(_id,action){if(action==='login')acknowledged=true;return {state:'LIVE',loginEpoch:randomUUID(),loginDeadlineAt:'future',loginPhase:'ENTER_REQUESTED'};}},
  heartbeatIntervalMs:5,pollIntervalMs:1}).then(value=>({value}),error=>({error}));
 assert.equal((await result).error,denied);assert.equal(acknowledged,false);
});
