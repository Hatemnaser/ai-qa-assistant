import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OddpathClient } from '../../../runner/src/http-client.js';
import { managedClaimedExecution } from '../../../runner/tests/fixtures.js';
import { claimManagedExecution } from '../../src/project-claim.mjs';
import { savedLoginRegistration, renewProjectRegistration } from '../../src/project-registration.mjs';
import { hashCanonicalJson } from '@oddpath/runner';
import { runnerRegistrationV2Schema } from '@oddpath/qa-execution-contract';

process.env.NODE_ENV = 'test';
process.env.AI_ENABLED = 'false';
process.env.GUEST_AI_ENABLED = 'false';
process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/oddpath_review_inert';
process.env.QA_BROWSER_RUNTIME_ENABLED = 'false';
process.env.QA_EXECUTION_V2_ENABLED = 'false';
const { createQaRunnerService } = await import('../../../api/src/modules/qa-requests/qa-runner.service.js');

for (const match of [true, false]) test(`v2 service receipt ${match ? 'allows' : 'blocks'} a project-bound claim`, async () => {
  const claimed = managedClaimedExecution(), paths: string[] = [];
  const registration = { schemaVersion: 2 as const, displayName: 'Contract fixture', executorKeys: ['playwright' as const],
    instanceId: 'fixture-runner', profiles: [claimed.task.profile], protocolVersions: [2 as const], runnerVersion: 'fixture' };
  const service = createQaRunnerService({ projectAccess: { async assertProjectAccess() {} } as never, repository: {
    async listRegistrations() { return []; },
    async upsertRegistration(input) {
      assert.equal(input.projectId, claimed.task.projectId);
      return { id: 'fixture-registration', lastSeenAt: new Date() };
    },
  } });
  const client = new OddpathClient({ protocolVersion: 2, serverUrl: 'https://api.example.test', token: 'fixture-only',
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      if (path.endsWith('/registration')) return Response.json(await service.register(
        { connectionId: 'fixture-token', projectId: claimed.task.projectId } as never, JSON.parse(String(init?.body))));
      assert.equal(path, '/api/integrations/v1/runner/v2/executions/claim');
      assert.deepEqual(JSON.parse(String(init?.body)), { instanceId: registration.instanceId, registrationId: 'fixture-registration' });
      return Response.json(claimed);
    } });
  const project = { client, registration, projectId: match ? claimed.task.projectId : 'another-project' };
  if (match) assert.deepEqual(await claimManagedExecution(project), claimed);
  else await assert.rejects(claimManagedExecution(project), /Project configuration mismatch/u);
  assert.equal(paths.length, match ? 2 : 1);
});

function savedFixture(key='staging-customer-portal',label='Customer portal') {
  const claimed=managedClaimedExecution();
  const {manifestHash,...manifest}=claimed.task.profile;
  const manual={...manifest,profileKey:key,label,authentication:{kind:'MANUAL' as const}};
  const registration=runnerRegistrationV2Schema.parse({schemaVersion:2,displayName:'Saved fixture',executorKeys:['playwright'],instanceId:'saved-fixture',
    profiles:[{...manual,manifestHash:hashCanonicalJson(manual)}],protocolVersions:[2],runnerVersion:'fixture'});
  const state={id:'7d46deaa-eef4-47e0-829c-c853ce10dc0a',revision:1,targetRevisionId:manual.target.revisionId,targetHash:manual.target.targetHash,
    revoked:false,expiresAt:new Date(Date.now()+60_000).toISOString()};
  return {claimed,registration,state};
}

for(const [key,label] of [['staging-customer-portal','Customer portal'],['x'.repeat(64),'L'.repeat(120)],['emoji-boundary','A'.repeat(108)+'😀'+'B'.repeat(10)],['emoji-only','😀'.repeat(60)]])test(`bounded saved profile registers through service/client and reaches claim: ${key}/${label.length}`,async()=>{
  const {claimed,registration,state}=savedFixture(key,label);let registered=registration,claims=0;
  const service=createQaRunnerService({projectAccess:{async assertProjectAccess(){}} as never,repository:{
    async listRegistrations(){return [];},
    async upsertRegistration(input){registered=runnerRegistrationV2Schema.parse(input.registration);return {id:'fixture-registration',lastSeenAt:new Date()};},
  }});
  const client=new OddpathClient({protocolVersion:2,serverUrl:'https://api.example.test',token:'fixture-only',fetch:async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith('/saved-logins'))return Response.json({states:[state]});
    if(path.endsWith('/registration'))return Response.json(await service.register({connectionId:'fixture-token',projectId:claimed.task.projectId} as never,JSON.parse(String(init?.body))));
    assert.ok(path.endsWith('/claim'));claims++;return Response.json({claim:null});
  }});
  const project={projectId:claimed.task.projectId,client,registration,baseRegistration:structuredClone(registration)};
  await renewProjectRegistration(project,true);await claimManagedExecution(project);
  assert.equal(claims,1);assert.equal(registered.profiles.length,2);
  assert.equal(registered.profiles[0].authentication.kind,'MANUAL');
  const saved=registered.profiles[1];assert.equal(saved.authentication.kind,'SAVED_STATE');
  assert.ok(saved.profileKey.length<=64);assert.ok(saved.label.length<=120);
  assert.ok(saved.label.isWellFormed());
  const {manifestHash,...manifest}=saved;assert.equal(manifestHash,hashCanonicalJson(manifest));
});

test('full base identities produce stable distinct saved keys; expired/revoked/wrong targets are excluded and cap stays 20',()=>{
  const {registration,state}=savedFixture('x'.repeat(63)+'a');
  const second=savedFixture('x'.repeat(63)+'b').registration.profiles[0];registration.profiles.push(second);
  const states=[state,{...state,id:'revoked',revoked:true},{...state,id:'expired',expiresAt:new Date(0).toISOString()},
    {...state,id:'other-target',targetRevisionId:'other'},{...state,id:'other-hash',targetHash:'f'.repeat(64)}];
  const result=savedLoginRegistration(registration,states);
  assert.equal(result.profiles.length,4);assert.notEqual(result.profiles[2].profileKey,result.profiles[3].profileKey);
  assert.deepEqual(savedLoginRegistration(registration,states),result);
  const many=Array.from({length:30},(_,i)=>({...state,id:`7d46deaa-eef4-47e0-829c-${i.toString().padStart(12,'0')}`}));
  assert.equal(savedLoginRegistration(registration,many).profiles.length,20);
});

for(const failure of ['validation','registration','project-binding'])test(`failed ${failure} preserves confirmed registration and safely recovers claim`,async()=>{
  const {claimed,registration,state}=savedFixture();let registrations=0,claims=0,rejectPublication=true;
  const client={async savedLogins(){return {states:[failure==='validation'?{...state,revision:0}:state]};},
    async registerV2(candidate){registrations++;runnerRegistrationV2Schema.parse(candidate);
      if(rejectPublication&&candidate.profiles.length>1&&failure==='registration')throw new Error('Registration unavailable');
      return {projectId:rejectPublication&&candidate.profiles.length>1&&failure==='project-binding'?'other-project':claimed.task.projectId,registrationId:'fixture-registration'};},
    async claimV2(){claims++;return null;}};
  const project={projectId:claimed.task.projectId,client,registration,baseRegistration:structuredClone(registration)};
  await assert.rejects(renewProjectRegistration(project,true));assert.strictEqual(project.registration,registration);
  assert.equal(registrations,failure==='validation'?0:1);
  if(failure!=='validation'){
    await assert.rejects(claimManagedExecution(project));assert.equal(claims,0);assert.strictEqual(project.registration,registration);
    rejectPublication=false;
  }
  await claimManagedExecution(project);assert.equal(claims,1);assert.equal(project.registration.profiles[0].authentication.kind,'MANUAL');
  assert.equal(project.registration.profiles.length,failure==='validation'?1:2);
});
