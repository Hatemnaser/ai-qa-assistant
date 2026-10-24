import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {Pool} from 'pg';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{NODE_ENV:'test',REGISTRATION_MODE:'disabled',AI_ENABLED:'false',GUEST_AI_ENABLED:'false',QA_EXECUTION_V2_ENABLED:'true',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',
 QA_BROWSER_RUNTIME_ENABLED:'true',QA_BROWSER_VIEWER_ORIGIN:'https://browser.example.test',QA_BROWSER_VIEWER_SIGNING_KEY:'c'.repeat(64),
 QA_MANAGED_ROUTING_ENABLED:'true',QA_MANAGED_HOST_ID:'fixture-host',QA_MANAGED_ROUTING_KEY:'a'.repeat(64),QA_MANAGED_PROJECT_KEY:'b'.repeat(64),
 QA_INTEGRATION_IP_RATE_LIMIT_MAX:'1000',QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX:'1000',AUTH_LOGIN_RATE_LIMIT_MAX:'100',AUTH_GLOBAL_RATE_LIMIT_MAX:'1000'});
const {prisma}=await import('../src/db/prisma.ts');
const {createApp}=await import('../src/app.ts');
const {env}=await import('../src/config/env.ts');
const {hashPassword}=await import('../src/modules/auth/auth.security.ts');
const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
const {createQaTargetsRepository}=await import('../src/modules/qa-targets/qa-targets.repository.ts');
const {reconcileBrowserReservations}=await import('../src/modules/browser-runtime/browser-reservations.ts');
const owners:string[]=[],password='Managed routing synthetic passphrase 71!',passwordHash=await hashPassword(password);
const pool=new Pool({connectionString:process.env.DATABASE_URL});
let server=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
let url='http://127.0.0.1:'+(server.address() as {port:number}).port;
const host={'content-type':'application/json',authorization:'Bearer '+'a'.repeat(64)};
afterEach(async()=>{await prisma.user.deleteMany({where:{id:{in:owners.splice(0)}}});});
after(async()=>{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await pool.end();await prisma.$disconnect();});
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

it('M1 machine adapter rejects missing/tenant/cookie credentials before mutations and never exposes claim',async()=>{
 for(const headers of [{'content-type':'application/json'},{...host,authorization:'Bearer '+'z'.repeat(64)},{...host,cookie:'qa_session=fake'},{...host,origin:env.corsOrigins[0]!}]){
  assert.equal((await send('/api/internal/managed-browser/catalog',{},headers)).status,401);
 }
 const cors=await send('/api/internal/managed-browser/catalog',{}, {...host,origin:'https://evil.example'});assert.equal(cors.status,403);assert.equal(cors.body.code,'CORS_FORBIDDEN');
 assert.equal((await send('/api/internal/managed-browser/control',{projectId:'p',executionId:'j',action:'accept'})).status,400);
 assert.equal((await send('/api/integrations/v1/runner/v2/executions/claim',{instanceId:'x',registrationId:'y'},host)).status,401);
 assert.equal((await send('/api/integrations/v1/runner/v2/executions/claim',{instanceId:'x',registrationId:'y'},{...host,'x-oddpath-managed-host':env.qaManagedRoutingKey})).status,401);
});
it('M2 a new HTTP-created project is discovered after owner proof with no operator project/token edit',async()=>{
 const user=await owner();const p=await send('/api/projects',{name:'New managed project'},user.headers);assert.equal(p.status,201);
 const projectId=p.body.project?.id||p.body.id;assert.ok(projectId,JSON.stringify(p.body));
 const repository=createQaTargetsRepository(prisma),target=await repository.create({userId:user.id,projectId,label:'Staging',definition:{baseUrl:'https://example.com/',environmentKind:'STAGING',authenticationOrigins:[],resourceOrigins:[],candidate:null}});
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.projectId===projectId));
 const proof=await repository.challenge({projectId,targetId:target.targetId,expectedRevision:1,method:'DNS_TXT',challengeHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000)});
 await repository.confirm({projectId,targetId:target.targetId,revisionId:target.revisionId,verificationId:proof.id,verifiedAt:new Date(),validUntil:new Date(Date.now()+86400000)});
 const e=(await catalog()).body.entries.find((e:any)=>e.projectId===projectId);assert.ok(e);assert.equal(e.registration.profiles[0].target.revisionId,target.revisionId);
 assert.equal(await prisma.projectConnectionToken.count({where:{projectId,managedHostId:env.qaManagedHostId}}),1);
 assert.equal(await prisma.qaExecutionJob.count({where:{projectId}}),0,'Discovery grants no execution');
});
it('M3 concurrent discovery is idempotent, ownership isolated, revocation and restart never resurrect a binding',async()=>{
 const x=await prepared(),other=await owner();
 const responses=await Promise.all(Array.from({length:5},()=>catalog()));assert.ok(responses.every(r=>r.status===200));
 assert.equal(await prisma.projectConnectionToken.count({where:{projectId:x.f.project.id,managedHostId:env.qaManagedHostId}}),1);
 const forbidden=await fetch(url+`/api/projects/${x.f.project.id}/qa/runner-profiles`,{headers:other.headers});assert.equal(forbidden.status,404);
 const noCsrf={...x.user.headers};delete noCsrf[env.csrfHeaderName];
 assert.equal((await send(`/api/projects/${x.f.project.id}/connections/${x.e.connectionId}`,{},noCsrf,'DELETE')).status,403);
 await prisma.projectConnectionToken.update({where:{id:x.e.connectionId},data:{revokedAt:new Date()}});
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.connectionId===x.e.connectionId));
 assert.equal((await x.claim()).status,401);
 await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});server=createApp().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 url='http://127.0.0.1:'+(server.address() as {port:number}).port;
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.connectionId===x.e.connectionId));
 assert.equal((await prisma.projectConnectionToken.findUniqueOrThrow({where:{id:x.e.connectionId}})).revokedAt!==null,true);
});
it('M4 no approval means no claim; concurrent starts and claims preserve the browser reservation',async()=>{
 const x=await prepared();assert.equal((await x.claim()).body.claim,null);
 const attempts=await Promise.all([x.start(),x.start()]);assert.equal(attempts.filter(r=>r.status===201).length,1);
 const claims=await Promise.all([x.claim(),x.claim()]);assert.equal(claims.filter(r=>r.body.claim).length,1);
 assert.equal(await prisma.qaBrowserReservation.count({where:{ownerId:x.user.id,state:'ACTIVE'}}),1);
 assert.equal(await prisma.qaExecutionJob.count({where:{projectId:x.f.project.id,status:'CLAIMED'}}),1);
});
it('M5 revocation during an authenticated accept wait prevents RUNNING and retains the hold until exit',async()=>{
 const x=await running(),holder=await pool.connect();
 await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['oddpath:qa-request:'+x.f.request.id]);
 const accept=send(`/api/integrations/v1/runner/v2/executions/${x.job}/accept`,{},x.headers);
 let revoked:Promise<any>;
 try{
  // Observe actual backend waiting on this request, without a mocked clock.
  for(let i=0;;i++){const r=await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid<>pg_backend_pid()");if(r.rows[0].n)break;if(i>100)throw Error('accept did not wait');await new Promise(r=>setTimeout(r,20));}
  revoked=send(`/api/projects/${x.f.project.id}/connections/${x.e.connectionId}`,{},x.user.headers,'DELETE');
  for(let i=0;;i++){if((await prisma.projectConnectionToken.findUniqueOrThrow({where:{id:x.e.connectionId}})).revokedAt)break;if(i>100)throw Error('revoke did not commit');await new Promise(r=>setTimeout(r,20));}
 }finally{await holder.query('ROLLBACK');holder.release();}
 const accepted=await accept;assert.equal(accepted.status,401,JSON.stringify(accepted.body));assert.equal((await revoked!).status,200);
 assert.notEqual((await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:x.job}})).status,'RUNNING');
 assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'ACTIVE');
 const control=(projectId:string,action:string,exit?:unknown)=>send('/api/internal/managed-browser/control',{projectId,executionId:x.job,action,...(exit?{exit}:{})});
 assert.equal((await control('wrong-project','status')).status,404);
 assert.equal((await control(x.f.project.id,'status')).body.state,'STOP_REQUESTED');
 assert.equal((await control(x.f.project.id,'exit',{runtimeId:randomUUID(),processExited:true,observedAt:new Date().toISOString()})).status,409);
 assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'ACTIVE');
 assert.equal((await control(x.f.project.id,'exit',{runtimeId:x.runtimeId,processExited:true,observedAt:new Date().toISOString()})).body.state,'STOP_CONFIRMED');
 await prisma.$transaction(tx=>reconcileBrowserReservations(tx,()=>new Date()));
 assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'RELEASED');
});
it('M6 expired proof and target revision changes remove old profiles without reauthorizing a queued recipe',async()=>{
 const x=await prepared();await x.start();
 const old=x.e.registration.profiles[0].target;
 await prisma.qaTarget.update({where:{id:old.targetId},data:{currentRevision:2}});
 await prisma.qaTargetRevision.create({data:{targetId:old.targetId,revision:2,definition:{baseUrl:'https://example.com/',environmentKind:'STAGING',authenticationOrigins:[],resourceOrigins:[],candidate:null},targetHash:'f'.repeat(64),authorityUserId:x.user.id}});
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.targetId===old.targetId));
 const claimed=await x.claim();assert.equal(claimed.status,200);assert.equal(claimed.body.claim,null);
 assert.equal((await prisma.qaExecutionJob.findFirstOrThrow({where:{projectId:x.f.project.id}})).status,'FAILED');
 const u=await owner(false),f=await quotaBrowserFixture(prisma,u.id,new Date());assert.ok(!(await catalog()).body.entries.some((e:any)=>e.projectId===f.project.id));
 const expiredUser=await owner(),expired=await quotaBrowserFixture(prisma,expiredUser.id,new Date());
 await prisma.qaTargetVerification.updateMany({where:{revision:{target:{projectId:expired.project.id}}},data:{validUntil:new Date(Date.now()-1)}});
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.projectId===expired.project.id));
 const prodUser=await owner(),prod=await quotaBrowserFixture(prisma,prodUser.id,new Date()),targets=createQaTargetsRepository(prisma);
 const prodTarget=await prisma.qaTarget.findFirstOrThrow({where:{projectId:prod.project.id}});
 const revision=await targets.revise({userId:prodUser.id,projectId:prod.project.id,targetId:prodTarget.id,expectedRevision:1,label:'Production fixture',definition:{baseUrl:'https://example.com/',environmentKind:'PRODUCTION',authenticationOrigins:[],resourceOrigins:[],candidate:null}});
 const challenge=await targets.challenge({projectId:prod.project.id,targetId:prodTarget.id,expectedRevision:2,method:'DNS_TXT',challengeHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000)});
 await targets.confirm({projectId:prod.project.id,targetId:prodTarget.id,revisionId:revision.revisionId,verificationId:challenge.id,verifiedAt:new Date(),validUntil:new Date(Date.now()+86400000)});
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.projectId===prod.project.id));
 const advertised=await catalog({allowProduction:true,manualLogin:true}),prodEntry=advertised.body.entries.find((e:any)=>e.projectId===prod.project.id);
 assert.ok(prodEntry);assert.deepEqual(prodEntry.registration.profiles.map((p:any)=>p.authentication.kind),['NONE'],'API manual gate is still disabled');
});
it('M7 target pagination preserves all shards and a single project binding beyond the old 20-project list',async()=>{
 const user=await owner(),project=await prisma.project.create({data:{ownerId:user.id,name:'Paged targets'}}),repository=createQaTargetsRepository(prisma);
 for(let i=0;i<21;i++){
  const target=await repository.create({userId:user.id,projectId:project.id,label:'Target '+i,definition:{baseUrl:'https://example.com/',environmentKind:'STAGING',authenticationOrigins:[],resourceOrigins:[],candidate:null}});
  const proof=await repository.challenge({projectId:project.id,targetId:target.targetId,expectedRevision:1,method:'DNS_TXT',challengeHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000)});
  await repository.confirm({projectId:project.id,targetId:target.targetId,revisionId:target.revisionId,verificationId:proof.id,verifiedAt:new Date(),validUntil:new Date(Date.now()+86400000)});
  if(i===20)await prisma.qaTarget.update({where:{id:target.targetId},data:{id:'t'.repeat(120)}});
 }
 const first=await catalog();assert.equal(first.status,200);assert.equal(first.body.entries.length,20);assert.ok(first.body.next);
 const second=await catalog({after:first.body.next});assert.equal(second.status,200);assert.equal(second.body.entries.length,1);assert.equal(second.body.next,null);
 const entries=[...first.body.entries,...second.body.entries];assert.equal(new Set(entries.map(e=>e.targetId)).size,21);
 assert.equal(new Set(entries.map(e=>e.registration.instanceId)).size,21);assert.equal(new Set(entries.map(e=>e.connectionId)).size,1);
 assert.ok(entries.every(e=>e.registration.instanceId.length<=120));
});
it('M8 real account deletion removes managed bindings and old tokens cannot reach a replacement account',async()=>{
 const x=await prepared();const deleted=await send('/api/account',{currentPassword:password},x.user.headers,'DELETE');assert.equal(deleted.status,200,JSON.stringify(deleted.body));
 assert.equal(await prisma.projectConnectionToken.count({where:{id:x.e.connectionId}}),0);
 assert.ok(!(await catalog()).body.entries.some((e:any)=>e.projectId===x.f.project.id));assert.equal((await x.claim()).status,401);
 const other=await prepared();assert.notEqual(other.e.connectionId,x.e.connectionId);assert.notEqual(other.e.token,x.e.token);
 assert.equal((await send('/api/internal/managed-browser/control',{projectId:x.f.project.id,executionId:'deleted-job',action:'status'})).status,404);
});
it('M10 project deletion never deadlocks a waiting managed claim or registration',async()=>{
 const outcomes:Array<{operation:string;deletionError:string|null;status:number}>=[];
 for(const operation of ['claim','registration']){
  const x=await prepared();assert.equal((await x.start()).status,201);
  const holder=await pool.connect();await holder.query('BEGIN');
  const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['oddpath:project-lifecycle:'+x.f.project.id]);
  await holder.query('SELECT id FROM "Project" WHERE id=$1 FOR UPDATE',[x.f.project.id]);
  const pending=operation==='claim'?x.claim():send('/api/integrations/v1/runner/v2/registration',{
   ...x.e.registration,instanceId:x.e.registration.instanceId+'-new'},x.headers,'PUT');
  let deletionError:string|null=null;
  try{
   for(let i=0;;i++){
    const wait=await pool.query('SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid]);
    if(wait.rows[0].n)break;if(i>150)throw Error(operation+' never waited for deletion lock');
    await new Promise(r=>setTimeout(r,20));
   }
   await holder.query('DELETE FROM "Project" WHERE id=$1',[x.f.project.id]);await holder.query('COMMIT');
  }catch(error){deletionError=(error as {code?:string}).code||String(error);await holder.query('ROLLBACK');}
  finally{holder.release();}
  const response=await pending;outcomes.push({operation,deletionError,status:response.status});
  if(!deletionError)assert.equal(await prisma.projectConnectionToken.count({where:{id:x.e.connectionId}}),0);
 }
 assert.deepEqual(outcomes.map(o=>o.deletionError),[null,null],JSON.stringify(outcomes));
 assert.ok(outcomes.every(o=>[401,404].includes(o.status)),JSON.stringify(outcomes));
});
it('M9 disabling routing stops dispatch while a fresh API process still accepts physical cleanup',async()=>{
 const x=await running();
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/auth-public-worker.mts'],{
  env:{...process.env,QA_MANAGED_ROUTING_ENABLED:'false'},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let output='';child.stdout!.on('data',b=>output+=b);child.stderr!.on('data',b=>output+=b);
 const exited=new Promise<number|null>(r=>child.once('close',r));
 const previous=url;
 try{
  const ready=await Promise.race([once(child,'message'),exited.then(()=>{throw Error('Drain fixture exited: '+output);})]);
  url='http://127.0.0.1:'+(ready[0] as {port:number}).port;
  assert.equal((await catalog()).status,404);assert.equal((await x.claim()).status,401);
  const body={projectId:x.f.project.id,executionId:x.job};
  assert.equal((await send('/api/internal/managed-browser/control',{...body,action:'status'})).body.state,'STOP_REQUESTED');
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'ACTIVE');
  const result=await send('/api/internal/managed-browser/control',{...body,action:'exit',exit:{runtimeId:x.runtimeId,processExited:true,observedAt:new Date().toISOString()}});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state,'STOP_CONFIRMED');
  await prisma.$transaction(tx=>reconcileBrowserReservations(tx,()=>new Date()));
  assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:x.job}})).state,'RELEASED');
 }finally{url=previous;if(child.connected)child.send('stop');else child.kill('SIGTERM');assert.equal(await exited,0,output);}
});
