import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OddpathClient } from '../../../runner/src/http-client.js';
import { managedClaimedExecution } from '../../../runner/tests/fixtures.js';
import { hashCanonicalJson } from '@oddpath/runner';
import { executionTaskV2Schema, runnerRegistrationV2Schema } from '@oddpath/qa-execution-contract';
import { renewProjectRegistration } from '../../src/project-registration.mjs';
import { claimManagedExecution } from '../../src/project-claim.mjs';

process.env.NODE_ENV='test';process.env.AI_ENABLED='false';process.env.GUEST_AI_ENABLED='false';
process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:1/oddpath_review_inert';
const { createQaRunnerService }=await import('../../../api/src/modules/qa-requests/qa-runner.service.js');
const { createQaExecutionRepository }=await import('../../../api/src/modules/qa-requests/qa-execution.repository.js');
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};}

test('a delayed published renewal cannot make the actual claim repository fail a newly approved saved profile',async()=>{
  const committed=deferred(),acknowledge=deferred(),timeline:string[]=[],updates:Record<string,unknown>[]=[];
  const task=managedClaimedExecution().task,{manifestHash,...manifest}=task.profile;
  const manual={...manifest,profileKey:'portal',label:'Portal',authentication:{kind:'MANUAL' as const}};
  const registration=runnerRegistrationV2Schema.parse({schemaVersion:2,instanceId:'race-runner',displayName:'Race fixture',executorKeys:['playwright'],protocolVersions:[2],runnerVersion:'fixture',profiles:[{...manual,manifestHash:hashCanonicalJson(manual)}]});
  const state={id:'7d46deaa-eef4-47e0-829c-c853ce10dc0a',revision:1,targetRevisionId:manual.target.revisionId,targetHash:manual.target.targetHash,revoked:false,expiresAt:new Date(Date.now()+600000).toISOString()};
  let persisted=registration,job:any,registrations=0;
  const service=createQaRunnerService({projectAccess:{async assertProjectAccess(){}} as never,repository:{
    async listRegistrations(){return [];},
    async upsertRegistration(input){persisted=runnerRegistrationV2Schema.parse(input.registration);timeline.push('register:'+persisted.profiles.length);return {id:'registration-1',lastSeenAt:new Date()};},
  }});
  const {revision,revisionId,targetId,targetHash,...definition}=manual.target;
  const capacity={executionId:task.executionId,state:'QUEUED',queueExpiresAt:new Date(Date.now()+600000)};
  const tx={
    qaBrowserReservation:{
      async findUnique(){return capacity;},async findFirst(){return capacity;},
      async count(){return capacity.state==='ACTIVE'?1:0;},async updateMany(){return {count:0};},
      async update(input:any){Object.assign(capacity,input.data);return capacity;},
    },
    qaBrowserRuntime:{async count(){return 0;}},
    async $executeRaw(){return 0;},
    qaRunnerRegistration:{async findFirst(){return {id:'registration-1',instanceId:registration.instanceId,projectId:task.projectId};}},
    qaExecutionJob:{
      async findFirst(input:any){return input.where.status?.in?null:{id:job.id,requestId:job.requestId,deadlineAt:job.deadlineAt};},
      async updateMany(input:any){Object.assign(job,input.data);return {count:1};},
      async findUnique(){return {...job,runnerRegistration:{publicProfiles:persisted.profiles}};},
      async update(input:any){updates.push(input.data);Object.assign(job,input.data);},
    },
    qaTarget:{async findFirst(){return {id:targetId,currentRevision:revision};}},
    qaTargetRevision:{async findFirst(){return {id:revisionId,targetId,revision,targetHash,definition};}},
    qaTargetVerification:{async findFirst(){return {id:task.approval.verificationId,validUntil:new Date(Date.now()+600000)};}},
    qaSavedBrowserState:{async findFirst(){return {...state,ownerId:'owner',projectId:task.projectId,project:{ownerId:'owner'},createdAt:new Date(),expiresAt:new Date(state.expiresAt),revokedAt:null};}},
    qaRun:{async update(){return {version:2};}},
    qaRequest:{async update(){},async findUnique(){return null;}},
    qaWorkflowEvent:{async findFirst(){return null;},async create(){}},
  };
  const database={async $transaction(action:any){return action(tx);}};
  const repository=createQaExecutionRepository(database as never,()=>new Date(),{allowV2:true,requireRuntime:false,savedVault:{revocations:{allows:()=>true}} as never});
  const client=new OddpathClient({protocolVersion:2,serverUrl:'https://api.example.test',token:'fixture',fetch:async(url,init)=>{
    const route=new URL(String(url)).pathname;
    if(route.endsWith('/saved-logins'))return Response.json({states:[state]});
    if(route.endsWith('/registration')){
      const receipt=await service.register({projectId:task.projectId,connectionId:'fixture'} as never,JSON.parse(String(init?.body)));
      if(++registrations===1){committed.resolve();await acknowledge.promise;}
      return Response.json(receipt);
    }
    assert.ok(route.endsWith('/claim'));timeline.push('claim');
    const result=await repository.claim({protocolVersion:2,connectionTokenId:'fixture',request:JSON.parse(String(init?.body)),leaseExpiresAt:new Date(Date.now()+45000),leaseToken:'x'.repeat(43),actor:{kind:'INTEGRATION',transport:'REST',connectionTokenId:'fixture',userId:'owner'}});
    return Response.json(result||{claim:null});
  }});
  const project={projectId:task.projectId,client,registration,baseRegistration:structuredClone(registration)};
  const renewal=renewProjectRegistration(project,true);await committed.promise;
  const saved=persisted.profiles[1];
  const {bindingHash,...approval}=task.approval;
  const approved={...approval,profileManifestHash:saved.manifestHash};
  const binding={...approved,authentication:saved.authentication,executionLimits:saved.executionLimits,candidate:saved.target.candidate};
  const savedTask=executionTaskV2Schema.parse({...task,profile:saved,approval:{...approved,bindingHash:hashCanonicalJson(binding)}});
  job={id:task.executionId,projectId:task.projectId,requestId:task.requestId,runId:task.runId,protocolVersion:2,status:'QUEUED',deadlineAt:new Date(task.deadlineAt),
    profileKey:saved.profileKey,profileManifestHash:saved.manifestHash,runnerRegistrationId:'registration-1',artifactId:task.artifact.id,recipeId:task.recipe.id,recipeHash:task.recipe.hash,
    authorization:{...savedTask.approval,profileKey:saved.profileKey,runnerRegistrationId:'registration-1',runId:task.runId,binding,protocolVersion:2,approvedAt:new Date(approved.approvedAt),expiresAt:new Date(approved.expiresAt)},
    recipe:{id:task.recipe.id,profileManifest:saved,profileManifestHash:saved.manifestHash,recipeHash:task.recipe.hash,canonicalJson:task.recipe.bundle,revision:task.recipe.revision},
    artifact:task.artifact,run:{version:task.runVersion},request:{version:approved.requestVersion+1,selectedArtifactId:task.artifact.id}};
  timeline.push('owner-queued-new-profile');
  const claiming=claimManagedExecution(project);
  try{await new Promise(done=>setImmediate(done));assert.deepEqual(timeline,['register:2','owner-queued-new-profile']);}
  finally{acknowledge.resolve();}
  await renewal;const claimed=await claiming;
  assert.equal(claimed?.task.profile.manifestHash,saved.manifestHash);assert.equal(job.status,'CLAIMED');assert.deepEqual(updates,[]);
  assert.deepEqual(timeline,['register:2','owner-queued-new-profile','register:2','claim']);
  assert.deepEqual(project.registration,persisted);
});
