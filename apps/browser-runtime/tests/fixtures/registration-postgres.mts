import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Client } from 'pg';
import { OddpathClient } from '../../../runner/src/http-client.js';
import { managedClaimedExecution } from '../../../runner/tests/fixtures.js';
import { hashCanonicalJson } from '@oddpath/runner';
import { runnerRegistrationV2Schema } from '@oddpath/qa-execution-contract';
import { renewProjectRegistration } from '../../src/project-registration.mjs';
import { claimManagedExecution } from '../../src/project-claim.mjs';

assert.equal(process.env.ODDPATH_REGISTRATION_DB_TESTS,'1','Explicit disposable database acknowledgement required');
const url=new URL(process.env.ODDPATH_REGISTRATION_DB_URL||'');
assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.ok(url.port);
assert.equal(url.pathname,'/oddpath_phase03b_registration_test');assert.equal(url.search,'');
process.env.NODE_ENV='test';process.env.AI_ENABLED='false';process.env.GUEST_AI_ENABLED='false';
process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:1/oddpath_review_inert';
const { createQaRunnerService }=await import('../../../api/src/modules/qa-requests/qa-runner.service.js');
const database=new Client({connectionString:url.href});
before(async()=>{await database.connect();await database.query('CREATE TEMP TABLE registration_profiles (id serial, public_profiles jsonb NOT NULL)');});
after(async()=>{await database.end();});

for(const [name,label] of [
  ['ASCII','A'.repeat(120)],['Arabic','ع'.repeat(120)],
  ['emoji before cut','A'.repeat(107)+'😀'+'B'.repeat(11)],
  ['emoji across cut','A'.repeat(108)+'😀'+'B'.repeat(10)],['all emoji','😀'.repeat(60)],
])test(`real PostgreSQL JSONB stores manual and generated ${name} profiles, then client reaches claim`,async()=>{
  await database.query('TRUNCATE registration_profiles');
  const task=managedClaimedExecution().task,{manifestHash,...manifest}=task.profile;
  const manual={...manifest,label,profileKey:'staging-customer-portal',authentication:{kind:'MANUAL' as const}};
  const registration=runnerRegistrationV2Schema.parse({schemaVersion:2,instanceId:'unicode-fixture',displayName:'Unicode fixture',executorKeys:['playwright'],protocolVersions:[2],runnerVersion:'test',profiles:[{...manual,manifestHash:hashCanonicalJson(manual)}]});
  const state={id:'7d46deaa-eef4-47e0-829c-c853ce10dc0a',revision:1,targetRevisionId:manual.target.revisionId,targetHash:manual.target.targetHash,revoked:false,expiresAt:new Date(Date.now()+60000).toISOString()};
  const service=createQaRunnerService({projectAccess:{async assertProjectAccess(){}} as never,repository:{
    async listRegistrations(){return [];},
    async upsertRegistration(input){await database.query('INSERT INTO registration_profiles(public_profiles) VALUES ($1::jsonb)',[JSON.stringify(input.registration.profiles)]);return {id:'fixture-registration',lastSeenAt:new Date()};},
  }});
  let claims=0;
  const client=new OddpathClient({protocolVersion:2,serverUrl:'https://api.example.test',token:'fixture',fetch:async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith('/saved-logins'))return Response.json({states:[state]});
    if(path.endsWith('/claim')){claims++;return Response.json({claim:null});}
    assert.ok(path.endsWith('/registration'));
    return Response.json(await service.register({projectId:task.projectId,connectionId:'fixture'} as never,JSON.parse(String(init?.body))));
  }});
  await client.registerV2(registration);
  const project={projectId:task.projectId,client,registration,baseRegistration:structuredClone(registration)};
  await renewProjectRegistration(project,true);await claimManagedExecution(project);
  const stored=(await database.query('SELECT public_profiles FROM registration_profiles ORDER BY id DESC LIMIT 1')).rows[0].public_profiles;
  assert.equal(claims,1);assert.deepEqual(stored,project.registration.profiles);assert.equal(stored.length,2);
  assert.equal(stored[0].label,label);assert.ok(stored[1].label.length<=120);assert.ok(stored[1].label.isWellFormed());
  const {manifestHash:storedHash,...saved}=stored[1];assert.equal(storedHash,hashCanonicalJson(saved));
});
