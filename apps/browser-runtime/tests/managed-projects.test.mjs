import assert from 'node:assert/strict';
import {it} from 'node:test';
import {targetDefinitionSchema} from '@oddpath/qa-execution-contract';
import {hashCanonicalJson} from '@oddpath/runner';
import {ManagedProjectCatalog,managedRuntimeClient,managedProjectFetch} from '../src/managed-projects.mjs';
import {claimManagedExecution} from '../src/project-claim.mjs';
import {loadSupervisorConfig} from '../src/config.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

const config={discovery:{serverUrl:'https://api.example.com'},routingKey:'a'.repeat(64)};
function entry(projectId='project-1',revision=1){
  const definition=targetDefinitionSchema.parse({baseUrl:'https://example.com',environmentKind:'STAGING'});
  const profile={schemaVersion:2,profileKey:'managed-none',label:'Managed',authentication:{kind:'NONE'},environmentKind:'STAGING',
    evidenceKinds:['TEXT'],recipeSchemaVersions:[1],executorKey:'playwright',valueReferences:[],
    executionLimits:{preparationTimeoutMs:300000,executionTimeoutMs:600000},
    target:{...definition,revision,revisionId:'revision-'+revision,targetId:'target-'+projectId,targetHash:hashCanonicalJson(definition)}};
  return {projectId,targetId:profile.target.targetId,connectionId:'mb-'+projectId,token:'odp_live_'+'t'.repeat(43),expiresAt:Date.now()+60000,queued:true,
    registration:{schemaVersion:2,instanceId:'managed-'+projectId,displayName:'Managed',runnerVersion:'test',executorKeys:['playwright'],protocolVersions:[2],
      profiles:[{...profile,manifestHash:hashCanonicalJson(profile)}]}};
}
function fixture(initial=[entry()]){
 let entries=initial,error=false,time=Date.now();const calls=[];
 const createClient=options=>({runtime:async()=>({state:'LIVE'}),registerV2:async registration=>{
   calls.push({kind:'register',token:options.token,registration});
   const e=entries.find(x=>x.token===options.token&&x.registration.instanceId===registration.instanceId);
   return {projectId:e?.projectId||initial[0].projectId,registrationId:'reg-'+registration.instanceId};
 },claimV2:async()=>{calls.push({kind:'claim',token:options.token});return null;}});
 const fetcher=async(url,init)=>{
   calls.push({kind:'host',url,init});if(error)throw new Error('connection failed');
   return Response.json({schemaVersion:1,entries,next:null});
 };
 const catalog=new ManagedProjectCatalog(config,{fetcher,createClient,now:()=>time});
 return {catalog,calls,setEntries:value=>entries=value,fail:()=>error=true,advance:ms=>time+=ms};
}
it('discovers a new project without config edits and keeps execution on its project token',async()=>{
 const f=fixture();await f.catalog.refresh();const project=f.catalog.projects()[0];
 await claimManagedExecution(project);
 assert.equal(f.calls.find(c=>c.kind==='claim').token,'odp_live_'+'t'.repeat(43));
 const call=f.calls.find(c=>c.kind==='host');assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');
 assert.equal(call.init.headers.authorization,'Bearer '+config.routingKey);
 assert.ok(!JSON.parse(call.init.body).projectId);
});
it('retains registration identity and applies new target revisions without reviving old claims',async()=>{
 const f=fixture();await f.catalog.refresh();const project=f.catalog.projects()[0];
 f.setEntries([entry('project-1',2)]);await f.catalog.refresh();
 assert.equal(f.catalog.projects()[0],project);
 assert.equal(project.registration.profiles[0].target.revision,2);
 assert.equal(f.calls.filter(c=>c.kind==='register').at(-1).registration.profiles[0].target.revision,2);
});
it('catalog failure and expiry stop new claims instead of using stale cached bindings',async()=>{
 const f=fixture();await f.catalog.refresh();const project=f.catalog.projects()[0];
 f.fail();await assert.rejects(f.catalog.refresh());assert.deepEqual(f.catalog.projects(),[]);
 const count=f.calls.length;assert.equal(await claimManagedExecution(project),null);assert.equal(f.calls.length,count);
 const g=fixture();await g.catalog.refresh();const old=g.catalog.projects()[0];g.advance(60001);
 assert.deepEqual(g.catalog.projects(),[]);assert.equal(await claimManagedExecution(old),null);
});
it('removes withdrawn bindings while keeping stop/exit control available independently',async()=>{
 const f=fixture();await f.catalog.refresh();const project=f.catalog.projects()[0];f.setEntries([]);await f.catalog.refresh();
 assert.deepEqual(f.catalog.projects(),[]);assert.equal(await claimManagedExecution(project),null);
 const observed=[];const client=managedRuntimeClient(config,'project-1',async(url,init)=>{observed.push(JSON.parse(init.body));return Response.json({state:'STOP_CONFIRMED'});});
 await client.runtime('job-1','exit',{runtimeId:'runtime',processExited:true,observedAt:new Date().toISOString()});
 assert.deepEqual(observed[0],{projectId:'project-1',executionId:'job-1',action:'exit',exit:{runtimeId:'runtime',processExited:true,observedAt:observed[0].exit.observedAt}});
 await assert.rejects(client.runtime('job-1','accept'),/Unsupported/);assert.equal(observed.length,1);
});
it('validates all catalog pages before registering any partial snapshot',async()=>{
 let calls=0,registered=0;
 const catalog=new ManagedProjectCatalog(config,{fetcher:async()=>{
   calls++;return calls===1?Response.json({schemaVersion:1,entries:[entry()],next:'next'}):Response.json({schemaVersion:1,entries:[],next:'next'});
 },createClient:()=>({registerV2:async()=>{registered++;}})});
 await assert.rejects(catalog.refresh(),/cursor/);assert.equal(registered,0);assert.deepEqual(catalog.projects(),[]);
});
it('rejects mismatched target bindings and host responses without leaking credentials into errors',async()=>{
 const e=entry();e.targetId='other';const f=fixture([e]);
 await assert.rejects(f.catalog.refresh(),/binding/);assert.deepEqual(f.catalog.projects(),[]);
 const client=managedRuntimeClient(config,'project-1',async()=>Response.json({code:'BROWSER_RUNTIME_NOT_FOUND'},{status:404}));
 await assert.rejects(client.runtime('job','status'),error=>error.status===404&&error.code==='BROWSER_RUNTIME_NOT_FOUND'&&!error.message.includes(config.routingKey));
 const manual=entry(),profile=manual.registration.profiles[0];profile.authentication={kind:'MANUAL'};
 const {manifestHash,...manifest}=profile;profile.manifestHash=hashCanonicalJson(manifest);
 await assert.rejects(fixture([manual]).catalog.refresh(),/capabilities/);
});
it('does not attach the host credential to object storage or another origin',async()=>{
 const seen=[];const client=managedProjectFetch(config,async(url,init)=>{seen.push({url,headers:init.headers});return Response.json({});});
 await client('https://api.example.com/api/integrations/v1/runner/v2/executions/claim');
 await client('https://storage.example.com/api/integrations/v1/runner/v2/upload');
 await client('https://api.example.com/api/other');
 assert.equal(seen[0].headers.get('x-oddpath-managed-host'),config.routingKey);
 assert.equal(seen[1].headers.has('x-oddpath-managed-host'),false);assert.equal(seen[2].headers.has('x-oddpath-managed-host'),false);
});
it('requires exact HTTPS discovery, a separate key and no mixed static project mode',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-config-'));
 const old={config:process.env.ODDPATH_SUPERVISOR_CONFIG,key:process.env.ODDPATH_VIEWER_KEY_FILE};
 try{
  const path=join(dir,'config.json'),key=join(dir,'routing-key'),viewer=join(dir,'viewer-key');
  await writeFile(key,'a'.repeat(64));await writeFile(viewer,'b'.repeat(64));
  process.env.ODDPATH_SUPERVISOR_CONFIG=path;process.env.ODDPATH_VIEWER_KEY_FILE=viewer;
  const value={publicOrigin:'https://viewer.example.test',discovery:{serverUrl:'https://api.example.test',keyFile:key}};
  await writeFile(path,JSON.stringify(value));assert.equal((await loadSupervisorConfig()).projects.length,0);
  await writeFile(path,JSON.stringify({...value,projects:[{}]}));await assert.rejects(loadSupervisorConfig(),/configuration/);
  await writeFile(path,JSON.stringify({...value,discovery:{...value.discovery,serverUrl:'http://api.example.test'}}));await assert.rejects(loadSupervisorConfig(),/configuration/);
  await writeFile(path,JSON.stringify(value));await writeFile(key,'b'.repeat(64));await assert.rejects(loadSupervisorConfig(),/separate/);
 }finally{
  for(const [name,value]of [['ODDPATH_SUPERVISOR_CONFIG',old.config],['ODDPATH_VIEWER_KEY_FILE',old.key]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});
 }
});
it('closes discovery without allowing another claim from its last snapshot',async()=>{
 const f=fixture();await f.catalog.refresh();const project=f.catalog.projects()[0];await f.catalog.close();
 assert.deepEqual(f.catalog.projects(),[]);assert.equal(await claimManagedExecution(project),null);await assert.rejects(f.catalog.refresh(),/closed/);
});
it('keeps admitted targets available when a larger catalog exceeds the bounded host scan',async()=>{
 let page=0,registered=0;
 const catalog=new ManagedProjectCatalog(config,{fetcher:async()=>{
  const entries=Array.from({length:20},(_,n)=>entry('p'+(page*20+n)));page++;
  return Response.json({schemaVersion:1,entries,next:'cursor-'+String(page).padStart(3,'0')});
 },createClient:()=>({runtime:async()=>({}),registerV2:async registration=>{registered++;return{projectId:registration.instanceId.slice('managed-'.length),registrationId:'reg'};}})});
 await catalog.refresh();assert.equal(page,50);assert.equal(registered,1000);assert.equal(catalog.projects().length,1000);await catalog.close();
});

it('preserves operational login state and consent on the project-authorized status channel',async()=>{
 const state={runtimeId:'runtime',state:'LIVE',loginEpoch:'epoch',loginDeadlineAt:new Date(Date.now()+30000).toISOString(),loginPhase:'LOGIN',saveLoginConsentAt:new Date().toISOString()};
 const calls=[];
 const catalog=new ManagedProjectCatalog(config,{
  fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json(url.endsWith('/catalog')?{schemaVersion:1,entries:[entry()],next:null}:{runtimeId:'runtime',state:'STOP_CONFIRMED'});},
  createClient:()=>({registerV2:async()=>({projectId:'project-1',registrationId:'reg'}),runtime:async(id,action)=>{calls.push({projectAction:action});return state;}}),
 });
 try{
  await catalog.refresh();const project=catalog.projects()[0];
  assert.deepEqual(await project.client.runtime('job','status'),state);
  assert.deepEqual(await project.client.runtime('job','login',{}),state);
  assert.equal((await project.client.runtime('job','stop')).state,'STOP_CONFIRMED');
  assert.equal((await project.client.runtime('job','exit',{runtimeId:'runtime'})).state,'STOP_CONFIRMED');
  assert.deepEqual(calls.filter(c=>c.action).map(c=>c.action),['stop','exit']);
 }finally{await catalog.close();}
});

it('never substitutes cleanup authority for revoked operational status or login authority',async()=>{
 const denied=Object.assign(new Error('Project revoked'),{status:401});let entries=[entry()],controlCalls=0;
 const catalog=new ManagedProjectCatalog(config,{
  fetcher:async(url)=>{if(url.endsWith('/catalog'))return Response.json({schemaVersion:1,entries,next:null});controlCalls++;return Response.json({runtimeId:'runtime',state:'STOP_CONFIRMED'});},
  createClient:()=>({registerV2:async()=>({projectId:'project-1',registrationId:'reg'}),runtime:async()=>{throw denied;}}),
 });
 try{
  await catalog.refresh();const project=catalog.projects()[0];entries=[];await catalog.refresh();
  await assert.rejects(project.client.runtime('job','status'),error=>error===denied);
  await assert.rejects(project.client.runtime('job','login',{}),error=>error===denied);
  assert.equal(controlCalls,0);
  assert.equal((await project.client.runtime('job','stop')).state,'STOP_CONFIRMED');
  assert.equal((await project.client.runtime('job','exit',{})).state,'STOP_CONFIRMED');
  assert.equal(controlCalls,2);
 }finally{await catalog.close();}
});
