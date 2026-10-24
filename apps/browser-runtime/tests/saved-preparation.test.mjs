import {describe,it} from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sealBrowserState} from '@oddpath/qa-execution-contract/browser-state-crypto';
import {restoreSavedLogin,captureSavedLogin} from '../src/saved-preparation.mjs';
import {targetDefinitionSchema} from '@oddpath/qa-execution-contract';
import {hashCanonicalJson} from '@oddpath/runner';
import {ManagedProjectCatalog} from '../src/managed-projects.mjs';
const keys={activeVersion:'v1',keys:{v1:'1'.repeat(64)}},state={cookies:[],origins:[]};
function fixture(){
 const id='execution',runtime=randomUUID(),epoch=randomUUID(),claimId=randomUUID(),bindingHash='b'.repeat(64);
 const claimed={task:{executionId:id,approval:{bindingHash},profile:{target:{baseUrl:'https://example.com',authenticationOrigins:[]}}},claim:{claimId}};
 const local={runtime,token:'t',lease:Date.now()+45000,preparationDeadline:Date.now()+60000};
 const context={purpose:'RESTORE',executionId:id,runtimeId:runtime,claimId,bindingHash,controlEpoch:epoch,expiresAt:Date.now()+15000};let transitions=0,calls=0;
 const supervisor={requireLiveLease(){return local;},driver:{async endpoint(){return 'http://runtime';}},journal:{loginTransition(){transitions++;}},async http(){calls++;return {ok:true,json:async()=>({phase:'READY'})};}};
 const client={async runtime(_id,action){return action==='status'?{state:'LIVE',loginEpoch:epoch,saveLoginConsentAt:null}:{state:'LIVE'};},async savedState(){return {context,packet:sealBrowserState(state,context,keys)};}};
 return {claimed,local,context,supervisor,client,keys,transitions:()=>transitions,calls:()=>calls};
}

async function discovered(f){
 const definition=targetDefinitionSchema.parse({baseUrl:'https://example.com',environmentKind:'STAGING'});
 const profile={schemaVersion:2,profileKey:'managed-manual',label:'Manual',authentication:{kind:'MANUAL'},environmentKind:'STAGING',evidenceKinds:['TEXT'],recipeSchemaVersions:[1],executorKey:'playwright',valueReferences:[],
  executionLimits:{preparationTimeoutMs:300000,executionTimeoutMs:600000},target:{...definition,revision:1,revisionId:'revision',targetId:'target',targetHash:hashCanonicalJson(definition)}};
 const entry={projectId:'project',targetId:'target',connectionId:'connection',token:'odp_live_'+'t'.repeat(43),expiresAt:Date.now()+60000,queued:true,
  registration:{schemaVersion:2,instanceId:'managed-project',displayName:'Managed',runnerVersion:'test',executorKeys:['playwright'],protocolVersions:[2],profiles:[{...profile,manifestHash:hashCanonicalJson(profile)}]}};
 const catalog=new ManagedProjectCatalog({discovery:{serverUrl:'https://api.example.test'},routingKey:'a'.repeat(64),allowManualLogin:true,transferKeys:keys},{
  fetcher:async url=>Response.json(url.endsWith('/catalog')?{schemaVersion:1,entries:[entry],next:null}:{runtimeId:f.local.runtime,state:'LIVE'}),
  createClient:()=>({...f.client,savedLogins:async()=>({states:[]}),registerV2:async()=>({projectId:'project',registrationId:'registration'})}),
 });
 await catalog.refresh();return {catalog,client:catalog.projects()[0].client};
}
describe('saved authentication preparation',()=>{
 it('restores only the exact encrypted runtime/claim binding before acknowledging READY',async()=>{const f=fixture();assert.equal((await restoreSavedLogin(f)).completed,true);assert.equal(f.transitions(),2);assert.equal(f.calls(),1);});
 it('rejects replay into another runtime before sending plaintext to the browser',async()=>{const f=fixture();f.context.runtimeId=randomUUID();await assert.rejects(restoreSavedLogin(f));assert.equal(f.calls(),0);assert.equal(f.transitions(),0);});
 it('rechecks expiry after awaiting endpoint resolution',async()=>{const original=Date.now;let now=original();Date.now=()=>now;try{const f=fixture();let entered=false;f.supervisor.driver.endpoint=async()=>{entered=true;now=f.context.expiresAt+1;return 'http://runtime';};await assert.rejects(restoreSavedLogin(f),/expired/u);assert.equal(entered,true);assert.equal(f.calls(),0);}finally{Date.now=original;}});
 it('does not capture anything without an explicit owner consent',async()=>{const f=fixture();await captureSavedLogin(f);assert.equal(f.calls(),0);});
 it('restores encrypted state through the discovered client with the exact operational epoch',async()=>{
  const f=fixture(),d=await discovered(f);try{assert.deepEqual(await restoreSavedLogin({...f,client:d.client}),{completed:true,epoch:f.context.controlEpoch});assert.equal(f.calls(),1);assert.equal(f.transitions(),2);}finally{await d.catalog.close();}
 });
 it('preserves confirmed consent for capture through discovery and still skips capture without it',async()=>{
  const f=fixture();let consent=null,captures=0;
  f.client.runtime=async(_id,action)=>action==='status'?{state:'LIVE',loginEpoch:f.context.controlEpoch,saveLoginConsentAt:consent}:{state:'LIVE'};
  f.supervisor.http=async()=>({ok:true,json:async()=>state});
  f.client.savedState=async(_id,mode,_claim,transfer)=>{assert.equal(mode,'capture');assert.equal(transfer.context.controlEpoch,f.context.controlEpoch);assert.ok(transfer.packet);captures++;return {savedLoginId:randomUUID()};};
  const d=await discovered(f);try{await captureSavedLogin({...f,client:d.client});assert.equal(captures,0);consent=new Date().toISOString();await captureSavedLogin({...f,client:d.client});assert.equal(captures,1);}finally{await d.catalog.close();}
 });
});
