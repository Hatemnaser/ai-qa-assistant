import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{NODE_ENV:'test',REGISTRATION_MODE:'disabled',AI_ENABLED:'false',GUEST_AI_ENABLED:'false',QA_EXECUTION_V2_ENABLED:'true',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',
 QA_MANUAL_LOGIN_ENABLED:'true',QA_BROWSER_RUNTIME_ENABLED:'true',QA_BROWSER_VIEWER_ORIGIN:'https://browser.example.test',QA_BROWSER_VIEWER_SIGNING_KEY:'c'.repeat(64),
 QA_MANAGED_ROUTING_ENABLED:'true',QA_MANAGED_HOST_ID:'fixture-host',QA_MANAGED_ROUTING_KEY:'a'.repeat(64),QA_MANAGED_PROJECT_KEY:'b'.repeat(64),
 QA_INTEGRATION_IP_RATE_LIMIT_MAX:'1000',QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX:'1000',AUTH_LOGIN_RATE_LIMIT_MAX:'100',AUTH_GLOBAL_RATE_LIMIT_MAX:'1000'});
const {prisma}=await import('../src/db/prisma.ts');
const {createApp}=await import('../src/app.ts');
const {env}=await import('../src/config/env.ts');
const {hashPassword}=await import('../src/modules/auth/auth.security.ts');
const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
const {reconcileBrowserReservations}=await import('../src/modules/browser-runtime/browser-reservations.ts');
const owners:string[]=[],password='Managed routing synthetic passphrase 71!',passwordHash=await hashPassword(password);
let server=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
let url='http://127.0.0.1:'+(server.address() as {port:number}).port;
const host={'content-type':'application/json',authorization:'Bearer '+'a'.repeat(64)};
// The runtime workspace deliberately uses native .mjs rather than TS declarations.
const runtimeModule=(name:string)=>import(new URL('../../browser-runtime/src/'+name,import.meta.url).href);
afterEach(async()=>{await prisma.user.deleteMany({where:{id:{in:owners.splice(0)}}});});
after(async()=>{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await prisma.$disconnect();});
async function send(path:string,body:unknown,headers:Record<string,string>=host,method='POST'){
 const response=await fetch(url+path,{method,headers,body:JSON.stringify(body)});
 return {status:response.status,body:await response.json() as any};
}
async function owner(verified=true){
 const id='routing-'+randomUUID(),email=id+'@example.test';owners.push(id);
 await prisma.user.create({data:{id,email,passwordHash,emailVerifiedAt:verified?new Date():null,acceptedTermsAt:new Date(),acceptedTermsVersion:env.currentTermsVersion}});
 if(!verified)return {id,headers:{} as Record<string,string>};
 const csrf=await fetch(url+'/api/auth/csrf'),csrfBody=await csrf.json() as any;
 const headers:Record<string,string>={'content-type':'application/json',cookie:csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),[env.csrfHeaderName]:csrfBody.csrfToken};
 const login=await fetch(url+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({email,password})});
 assert.equal(login.status,200,await login.text());headers.cookie+='; '+login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return {id,headers};
}
const catalog=(body:unknown={})=>send('/api/internal/managed-browser/catalog',body);
async function prepared(){
 const user=await owner(),f=await quotaBrowserFixture(prisma,user.id,new Date());
 const c=await catalog();assert.equal(c.status,200);
 const e=c.body.entries.find((e:any)=>e.projectId===f.project.id);assert.ok(e);
 const headers={'content-type':'application/json',authorization:'Bearer '+e.token};
 const registered=await fetch(url+'/api/integrations/v1/runner/v2/registration',{method:'PUT',headers,body:JSON.stringify(e.registration)});
 const receipt=await registered.json() as any;assert.equal(registered.status,200,JSON.stringify(receipt));
 const profile=e.registration.profiles[0];
 await prisma.qaExecutionRecipe.update({where:{id:f.start.recipeId},data:{profileManifest:profile,profileManifestHash:profile.manifestHash}});
 const startBody={executionMode:'PLAYWRIGHT',expectedRequestVersion:f.start.expectedRequestVersion,profileKey:profile.profileKey,
  recipeId:f.start.recipeId,recipeHash:f.start.recipeHash,runnerRegistrationId:receipt.registrationId};
 const start=()=>send(`/api/projects/${f.project.id}/qa/requests/${f.request.id}/runs`,startBody,user.headers);
 const claim=()=>send('/api/integrations/v1/runner/v2/executions/claim',{instanceId:e.registration.instanceId,registrationId:receipt.registrationId},headers);
 return {user,f,e,headers,receipt,startBody,start,claim};
}
async function running(){
 const x=await prepared(),started=await x.start();assert.equal(started.status,201,JSON.stringify(started.body));
 const claimed=await x.claim();assert.equal(claimed.status,200);assert.ok(claimed.body.claim);
 const job=claimed.body.task.executionId,runtimeId=randomUUID(),lease={'x-oddpath-claim-id':claimed.body.claim.claimId,'x-oddpath-execution-lease':claimed.body.claim.leaseToken};
 const headers={...x.headers,...lease};
 const begin=await send(`/api/integrations/v1/runner/v2/executions/${job}/runtime`,{runtimeId,imageDigest:'sha256:'+'d'.repeat(64)},headers);
 assert.equal(begin.status,200,JSON.stringify(begin.body));
 return {...x,job,runtimeId,lease,headers};
}

it('R1 discovered MANUAL status drives owner begin/complete and retains narrow revocation cleanup',async()=>{
 const {ManagedProjectCatalog}=await runtimeModule('managed-projects.mjs');
 const {claimManagedExecution}=await runtimeModule('project-claim.mjs');
 const {waitForHumanPreparation}=await runtimeModule('human-preparation.mjs');
 const x=await prepared(),discovery=new ManagedProjectCatalog({discovery:{serverUrl:'https://fixture.example.test'},routingKey:'a'.repeat(64),allowManualLogin:true},
  {fetcher:(input:any,init:any)=>fetch(url+new URL(String(input)).pathname,init)});
 let preparation:Promise<any>|undefined,stopping=false;
 try{
  await discovery.refresh();const project=discovery.projects().find((p:any)=>p.projectId===x.f.project.id);assert.ok(project);
  const profile=project.registration.profiles.find((p:any)=>p.authentication.kind==='MANUAL');assert.ok(profile);
  await prisma.qaExecutionRecipe.update({where:{id:x.startBody.recipeId},data:{profileManifest:profile,profileManifestHash:profile.manifestHash}});
  x.startBody.profileKey=profile.profileKey;assert.equal((await x.start()).status,201);
  await discovery.refresh();const claimed=await claimManagedExecution(project);assert.ok(claimed);
  const id=claimed.task.executionId,runtimeId=randomUUID();
  await project.client.runtime(id,'begin',{runtimeId,imageDigest:'sha256:'+'d'.repeat(64),preparationDeadlineAt:new Date(Date.now()+250000).toISOString()},claimed.claim);
  const initial=await project.client.runtime(id,'status');assert.equal(initial.loginPhase,'WAITING');assert.ok(initial.loginDeadlineAt&&initial.loginEpoch);
  const narrow=await send('/api/internal/managed-browser/control',{projectId:x.f.project.id,executionId:id,action:'status'});
  assert.deepEqual(Object.keys(narrow.body).sort(),['runtimeId','state']);
  let localPhase='PREPARING';const physical:string[]=[];
  preparation=waitForHumanPreparation({claimed,client:project.client,journal:{get:()=>({loginPhase:localPhase})},stopping:()=>stopping,heartbeatIntervalMs:1000,pollIntervalMs:5,
   supervisor:{requireLiveLease:()=>({runtime:runtimeId}),renew:async()=>{},stop:async()=>{},login:async(_id:string,action:string,epoch:string)=>{
    assert.equal(epoch,initial.loginEpoch);physical.push(action);localPhase=action==='begin'?'LOGIN':'READY';}}});
  const ownerPath=`/api/projects/${x.f.project.id}/browser-runtimes/${id}/login/`;
  assert.equal((await send(ownerPath+'begin',{controlEpoch:initial.loginEpoch},x.user.headers)).status,200);
  for(let n=0;;n++){
   if((await project.client.runtime(id,'status')).loginPhase==='LOGIN')break;
   if(n>100)throw Error('LOGIN was not acknowledged');await new Promise(r=>setTimeout(r,10));
  }
  assert.equal((await send(ownerPath+'complete',{controlEpoch:initial.loginEpoch},x.user.headers)).status,400,'Completion requires explicit owner acknowledgement');
  const completed=await send(ownerPath+'complete',{controlEpoch:initial.loginEpoch,acknowledgeFinished:true},x.user.headers);
  assert.equal(completed.status,200,JSON.stringify(completed.body));
  assert.deepEqual(await preparation,{completed:true,epoch:initial.loginEpoch});
  assert.deepEqual(physical,['begin','complete']);assert.equal((await project.client.runtime(id,'status')).loginPhase,'READY');
  await prisma.projectConnectionToken.update({where:{id:x.e.connectionId},data:{revokedAt:new Date()}});
  await assert.rejects(project.client.runtime(id,'status'),{status:401});
  assert.equal((await project.client.runtime(id,'stop')).state,'STOP_REQUESTED');
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:id}})).state,'ACTIVE');
  assert.equal((await project.client.runtime(id,'exit',{runtimeId,processExited:true,observedAt:new Date().toISOString()})).state,'STOP_CONFIRMED');
  await prisma.$transaction(tx=>reconcileBrowserReservations(tx,()=>new Date()));
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:id}})).state,'RELEASED');
 }finally{stopping=true;await preparation?.catch(()=>{});await discovery.close();}
});

it('R2 failure reporting survives all lost HTTP receipts, journal reopen and concurrent retries exactly once',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join,resolve,sep}=await import('node:path');
 const {OddpathClient}=await import('@oddpath/runner');
 const {RuntimeJournal}=await runtimeModule('journal.mjs');
 const {deferPreparationFailure,retryFailureReports}=await runtimeModule('failure-reports.mjs');
 const x=await running(),directory=await mkdtemp(join(tmpdir(),'report-recovery-')),path=join(directory,'runtime.sqlite');
 let journal=new RuntimeJournal(path),second:any;const messages:string[]=[],requests:Array<{key:string|null;status:number}>=[];let drop=true;
 const client=new OddpathClient({serverUrl:url,token:x.e.token,protocolVersion:2,delay:async()=>{},fetch:async(input,init)=>{
  const response=await fetch(input,init);
  if(new URL(String(input)).pathname.endsWith('/fail')){requests.push({key:new Headers(init?.headers).get('idempotency-key'),status:response.status});if(drop){await response.text();throw Error('Injected connection loss after server commit');}}
  return response;
 }});
 const options=()=>({journal,projects:[{projectId:x.f.project.id,client}],logger:{error:(m:string)=>messages.push(m)}});
 try{
  const claimed={task:{executionId:x.job,projectId:x.f.project.id,deadlineAt:new Date(Date.now()+60000).toISOString()},claim:{claimId:x.lease['x-oddpath-claim-id'],leaseToken:x.lease['x-oddpath-execution-lease']}};
  deferPreparationFailure(journal,claimed);await retryFailureReports(options());
  assert.equal(requests.length,4);assert.ok(requests.every(r=>r.status===200&&r.key));assert.equal(journal.pendingFailures().length,1);
  const failed=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:x.job},include:{run:true}});
  assert.equal(failed.status,'FAILED');assert.equal(failed.errorCode,'BROWSER_SESSION_UNAVAILABLE');assert.equal(failed.attempts,1);
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'ACTIVE','Failure receipt is not physical Stop proof');
  journal.close();journal=new RuntimeJournal(path);second=new RuntimeJournal(path);drop=false;
  await Promise.all([retryFailureReports(options()),retryFailureReports({...options(),journal:second})]);
  assert.equal(journal.pendingFailures().length,0);assert.equal(new Set(requests.map(r=>r.key)).size,1);
  const after=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:x.job},include:{run:true}});
  assert.equal(after.run.version,failed.run.version);assert.equal(after.attempts,1);assert.equal(after.completedAt?.getTime(),failed.completedAt?.getTime());
  assert.match(messages[0]!,/retained/);
  assert.equal((await send('/api/internal/managed-browser/control',{projectId:x.f.project.id,executionId:x.job,action:'stop'})).status,200);
  assert.equal((await send('/api/internal/managed-browser/control',{projectId:x.f.project.id,executionId:x.job,action:'exit',exit:{runtimeId:x.runtimeId,processExited:true,observedAt:new Date().toISOString()}})).status,200);
  await prisma.$transaction(tx=>reconcileBrowserReservations(tx,()=>new Date()));
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'RELEASED');
 }finally{second?.close();journal.close();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
});


