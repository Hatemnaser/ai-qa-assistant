// Explicitly composed local acceptance: real API/PG, new catalog, existing
// allocation/Runner, Chrome and physical exit. HTTP fixture transport is not TLS proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
assert.equal(process.env.ODDPATH_MANAGED_DOCKER_TESTS,'1');
Object.assign(process.env,{NODE_ENV:'test',REGISTRATION_MODE:'disabled',AI_ENABLED:'false',GUEST_AI_ENABLED:'false',QA_EXECUTION_V2_ENABLED:'true',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',
 QA_BROWSER_RUNTIME_ENABLED:'true',QA_BROWSER_VIEWER_ORIGIN:'https://browser.example.test',QA_BROWSER_VIEWER_SIGNING_KEY:'c'.repeat(64),
 QA_MANAGED_ROUTING_ENABLED:'true',QA_MANAGED_HOST_ID:'fixture-host',QA_MANAGED_ROUTING_KEY:'a'.repeat(64),QA_MANAGED_PROJECT_KEY:'b'.repeat(64)});
const {prisma}=await import('../src/db/prisma.ts');
const {createApp}=await import('../src/app.ts');
const {hashPassword}=await import('../src/modules/auth/auth.security.ts');
const {env}=await import('../src/config/env.ts');
const {quotaBrowserFixture}=await import('./helpers/quotaBrowserFixture.ts');
const {createQaTargetsRepository}=await import('../src/modules/qa-targets/qa-targets.repository.ts');
const {reconcileBrowserReservations}=await import('../src/modules/browser-runtime/browser-reservations.ts');
const {hashCanonicalJson}=await import('../src/lib/canonical-json.ts');
const {ManagedProjectCatalog}=await import('../../browser-runtime/src/managed-projects.mjs');
const {claimManagedExecution}=await import('../../browser-runtime/src/project-claim.mjs');
const {DockerRuntimeDriver}=await import('../../browser-runtime/src/docker-driver.mjs');
const {RuntimeJournal}=await import('../../browser-runtime/src/journal.mjs');
const {BrowserSupervisor}=await import('../../browser-runtime/src/supervisor.mjs');
const {assertSupervisorImageParity}=await import('../../browser-runtime/tests/image-parity.mjs');
const execute=promisify(execFile),id='routing-e2e-'+randomUUID(),controller=id+'-controller',ownerId='owner-'+id,password='Synthetic managed browser fixture 73!';
const docker=async args=>(await execute('docker',args,{timeout:45000,maxBuffer:2*1024*1024})).stdout.trim();
const directory=await mkdtemp(join(tmpdir(),id));
let server,journal,driver,supervisor,catalog,row;
try{
 const endpoint=JSON.parse(await docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));assert.match(endpoint,/^(unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/);
 const chromeImage=await docker(['image','inspect','oddpath/chrome-runtime:phase-02','--format','{{.Id}}']);
 const egressImage=await docker(['image','inspect','oddpath/browser-egress:phase-02','--format','{{.Id}}']);
 const supervisorImage=process.env.ODDPATH_SUPERVISOR_TEST_IMAGE||'oddpath/browser-supervisor:managed-routing-20261020';
 await assertSupervisorImageParity(docker,supervisorImage);
 await docker(['run','-d','--pull=never','--name',controller,'--label','com.oddpath.routing-e2e='+id,'--network','bridge','-v','/var/run/docker.sock:/var/run/docker.sock','--entrypoint','node',supervisorImage,'-e','setInterval(()=>{},1000)']);
 server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const port=server.address().port,url='http://127.0.0.1:'+port;
 // Synthetic allowlisted control transport. Production config requires HTTPS.
 const config={discovery:{serverUrl:'https://api.fixture.test'},routingKey:'a'.repeat(64)};
 const http=(input,init)=>{const target=new URL(input);assert.equal(target.origin,config.discovery.serverUrl);return fetch(url+target.pathname+target.search,init);};
 await prisma.user.create({data:{id:ownerId,email:ownerId+'@example.test',emailVerifiedAt:new Date(),passwordHash:await hashPassword(password),acceptedTermsAt:new Date(),acceptedTermsVersion:env.currentTermsVersion}});
 const f=await quotaBrowserFixture(prisma,ownerId,new Date()),targets=createQaTargetsRepository(prisma);
 const original=await prisma.qaTarget.findFirstOrThrow({where:{projectId:f.project.id}});
 const target=await targets.revise({userId:ownerId,projectId:f.project.id,targetId:original.id,expectedRevision:1,label:'Example fixture',definition:{baseUrl:'https://example.com/',environmentKind:'STAGING',resourceOrigins:[],authenticationOrigins:[],candidate:null}});
 const proof=await targets.challenge({projectId:f.project.id,targetId:target.targetId,expectedRevision:2,method:'DNS_TXT',challengeHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000)});
 await targets.confirm({projectId:f.project.id,targetId:target.targetId,revisionId:target.revisionId,verificationId:proof.id,verifiedAt:new Date(),validUntil:new Date(Date.now()+86400000)});
 catalog=new ManagedProjectCatalog(config,{fetcher:http});await catalog.refresh();
 let project=catalog.projects().find(p=>p.projectId===f.project.id);assert.ok(project);assert.equal(await claimManagedExecution(project),null);
 const recipe=await prisma.qaExecutionRecipe.findUniqueOrThrow({where:{id:f.start.recipeId}}),bundle=recipe.canonicalJson;
 // This public fixture has no semantic heading (captured in the retained first
 // run). Use its observable documentation statement, as the maintained egress
 // fixture does; no existing product/test assertion is changed.
 bundle.items[0].steps[1].expectation.locator={by:'text',value:'This domain is for use in documentation examples'};
 await prisma.qaChecklistItem.update({where:{id:bundle.items[0].checklistItemId},data:{title:'Example page statement',expectedResult:'The documentation example statement is visible.'}});
 const recipeHash=hashCanonicalJson(bundle),profile=project.registration.profiles[0];
 await prisma.qaExecutionRecipe.update({where:{id:recipe.id},data:{canonicalJson:bundle,recipeHash,profileManifest:profile,profileManifestHash:profile.manifestHash}});
 // The quota-only seed omits normalized recipe items. A real execution must
 // persist the same step rows as the normal recipe submission repository, so
 // the API can validate the Runner's structured observation against them.
 await prisma.qaExecutionRecipeItem.createMany({data:bundle.items.map((item,ordinal)=>({recipeId:recipe.id,checklistItemId:item.checklistItemId,steps:item.steps,ordinal,recipeHash:hashCanonicalJson(item)}))});
 const registration=await prisma.qaRunnerRegistration.findUniqueOrThrow({where:{connectionTokenId_instanceId:{connectionTokenId:project.connectionId,instanceId:project.registration.instanceId}}});
 const csrf=await fetch(url+'/api/auth/csrf'),csrfBody=await csrf.json();
 const headers={'content-type':'application/json',cookie:csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),[env.csrfHeaderName]:csrfBody.csrfToken};
 const logged=await fetch(url+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({email:ownerId+'@example.test',password})});assert.equal(logged.status,200);
 headers.cookie+='; '+logged.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const started=await fetch(url+`/api/projects/${f.project.id}/qa/requests/${f.request.id}/runs`,{method:'POST',headers,body:JSON.stringify({executionMode:'PLAYWRIGHT',expectedRequestVersion:1,
  profileKey:profile.profileKey,recipeId:recipe.id,recipeHash,runnerRegistrationId:registration.id})});assert.equal(started.status,201,await started.text());
 await catalog.refresh();project=catalog.projects().find(p=>p.projectId===f.project.id);const claimed=await claimManagedExecution(project);assert.ok(claimed);
 journal=new RuntimeJournal(join(directory,'runtime.sqlite'));
 driver=new DockerRuntimeDriver({instanceId:id,supervisorContainer:controller,chromeImage,egressImage});supervisor=new BrowserSupervisor({driver,journal});
 row=await supervisor.allocate(claimed.task,Date.parse(claimed.claim.leaseExpiresAt),reserved=>project.client.runtime(claimed.task.executionId,'begin',{runtimeId:reserved.runtime,imageDigest:chromeImage},claimed.claim));
 const browserInfo=JSON.parse(await docker(['inspect',driver.names(row.runtime).browser]))[0];
 const browserEnv=JSON.stringify(browserInfo.Config.Env);
 for(const secret of [config.routingKey,project.token,env.qaManagedProjectKey])assert.ok(!browserEnv.includes(secret),'Control-plane keys must not reach Chrome');
 const browserEndpoint=await driver.endpoint(row.runtime),api='http://host.docker.internal:'+port;
 const script=`let raw='';for await(const b of process.stdin)raw+=b;const p=JSON.parse(raw);
 const {OddpathClient,executeClaim,createManagedPlaywrightSession}=await import('@oddpath/runner');
 const {DockerRuntimeDriver}=await import('./apps/browser-runtime/src/docker-driver.mjs');
 const driver=new DockerRuntimeDriver(p.driver),client=new OddpathClient({serverUrl:p.api,token:p.token,protocolVersion:2});
 const control=async action=>{const r=await fetch(p.api+'/api/internal/managed-browser/control',{method:'POST',headers:{authorization:'Bearer '+p.routingKey,'content-type':'application/json'},body:JSON.stringify({projectId:p.claimed.task.projectId,executionId:p.claimed.task.executionId,action})});if(!r.ok)throw Error('Control failed '+r.status);return r.json();};
 const createSession=async()=>{const session=await createManagedPlaywrightSession(p.endpoint,p.runtimeToken,p.claimed.task.profile.target.baseUrl),navigate=session.navigate.bind(session);
 session.navigate=async(...args)=>{await navigate(...args);const data=await(await fetch(p.endpoint+'/cdp/json/version',{headers:{authorization:'Bearer '+p.runtimeToken}})).json();const {chromium}=await import('playwright');const inspection=await chromium.connectOverCDP(p.endpoint.replace(/^http/,'ws')+'/cdp'+new URL(data.webSocketDebuggerUrl).pathname,{headers:{authorization:'Bearer '+p.runtimeToken}});const page=inspection.contexts()[0].pages()[0];console.log(JSON.stringify({pageDiagnostic:true,url:page.url(),title:await page.title(),headings:await page.locator('h1,h2').allTextContents(),expectation:p.claimed.task.recipe.bundle.items[0].steps[1].expectation}));};return session;};
 const receipt=await executeClaim(p.claimed,{allowProduction:false,client,profiles:[],heartbeatIntervalMs:5000,createSession,
 managedV2:{profileHashes:[p.claimed.task.profile.manifestHash],assertRuntimeLive:async()=>{if((await control('status')).state!=='LIVE')throw Error('Not live');},beforeSteps:async()=>{},terminate:async()=>{await control('stop');const proof=await driver.stop(p.runtime);const r=await fetch(p.api+'/api/internal/managed-browser/control',{method:'POST',headers:{authorization:'Bearer '+p.routingKey,'content-type':'application/json'},body:JSON.stringify({projectId:p.claimed.task.projectId,executionId:p.claimed.task.executionId,action:'exit',exit:{runtimeId:p.runtime,processExited:true,observedAt:new Date(proof.observedAt).toISOString()}})});if(!r.ok)throw Error('Exit failed '+r.status);}}});
 console.log(JSON.stringify({E2E:true,status:receipt?.status}));`;
 const child=spawn('docker',['exec','-i',controller,'node','--input-type=module','-e',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 child.stdin.end(JSON.stringify({api,claimed,token:project.token,routingKey:config.routingKey,endpoint:browserEndpoint,runtime:row.runtime,runtimeToken:row.token,driver:{instanceId:id,supervisorContainer:controller,chromeImage,egressImage}}));
 const timer=setTimeout(()=>child.kill(),90000);const code=await new Promise(r=>child.on('close',r));clearTimeout(timer);
 assert.equal(code,0,output.replaceAll(project.token,'[secret]').replaceAll(row.token,'[secret]'));
 const result=output.split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(r=>r?.E2E);assert.equal(result?.status,'SUCCEEDED',output);
 const job=await prisma.qaExecutionJob.findUniqueOrThrow({where:{id:claimed.task.executionId},include:{browserRuntime:true,run:{include:{results:true}}}});
 assert.equal(job.status,'SUCCEEDED');assert.equal(job.run.results.length,1);assert.equal(job.run.results[0].status,'PASS',JSON.stringify({result:job.run.results[0],output}));assert.equal(job.browserRuntime.state,'STOP_CONFIRMED');
 await prisma.$transaction(tx=>reconcileBrowserReservations(tx,()=>new Date()));assert.equal((await prisma.qaBrowserReservation.findUniqueOrThrow({where:{executionId:job.id}})).state,'RELEASED');
 assert.equal(await prisma.usageEvent.count({where:{userId:ownerId}}),0,'No provider call was needed');
 console.log(JSON.stringify({status:'PASS_MANAGED_ROUTING_DOCKER_E2E',discoveredWithoutProjectConfig:true,ownerHttpApproval:true,realChromePlaywright:true,immutableRecipePassed:true,physicalStopConfirmed:true,reservationReleased:true,providerCalls:0,transport:'LOCAL_HTTP_FIXTURE_NOT_TLS_PROOF'}));
}finally{
 await catalog?.close();if(row)await supervisor.stop(row.execution).catch(()=>{});journal?.close();
 try{const info=JSON.parse(await docker(['inspect',controller]))[0];assert.equal(info.Config.Labels['com.oddpath.routing-e2e'],id);await docker(['rm','-f','-v',controller]);}catch(error){if(!String(error).includes('No such'))throw error;}
 if(server)await new Promise(r=>{server.close(()=>r());server.closeAllConnections();});
 await prisma.user.deleteMany({where:{id:ownerId}});await prisma.$disconnect();
 assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});
}
