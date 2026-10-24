import assert from 'node:assert/strict';
import {test} from 'node:test';
import {executionObservationSchema, qaEvidenceProvenanceSchema, hasQaEvidenceContent} from '../src/evidence.js';
const observation={startedAt:'2026-10-14T12:00:00Z',finishedAt:'2026-10-14T12:00:01Z',completedStepRefs:['open','expect'],failedStepRef:null};
test('executor timing rejects reversed times, duplicate steps and credential fields',()=>{
 assert.deepEqual(executionObservationSchema.parse(observation),observation);
 assert.equal(executionObservationSchema.safeParse({...observation,startedAt:observation.finishedAt,finishedAt:observation.startedAt}).success,false);
 assert.equal(executionObservationSchema.safeParse({...observation,completedStepRefs:['open','open']}).success,false);
 assert.equal(executionObservationSchema.safeParse({...observation,password:'secret'}).success,false);
});

test('provenance preserves the full supported environment and rejects an oversized description',()=>{
 const provenance={schemaVersion:1,projectId:'project',requestId:'request',runId:'run',artifactId:'artifact',checklistItemId:null,expectedResult:null,
  target:{url:null,environment:'e'.repeat(500),revisionId:null,definitionHash:null},build:{reference:null,source:'UNKNOWN'},executor:{kind:'USER',transport:'WEB',registrationId:null},recordedAt:observation.startedAt,observation:null,recipeHash:null};
 assert.equal(qaEvidenceProvenanceSchema.parse(provenance).target.environment,provenance.target.environment);
 assert.equal(qaEvidenceProvenanceSchema.safeParse({...provenance,target:{...provenance.target,environment:'e'.repeat(501)}}).success,false);
});

test('linked screenshots require an HTTPS reference without credentials',()=>{
 for(const reference of ['https://evidence.example.test/proof.png','HTTPS://evidence.example.test/proof.png'])
  assert.equal(hasQaEvidenceContent({kind:'SCREENSHOT',assets:[],externalReference:reference}),true);
 for(const reference of [null,'','not a URL','http://evidence.example.test/proof.png','https://user:password@evidence.example.test/proof.png'])
  assert.equal(hasQaEvidenceContent({kind:'SCREENSHOT',assets:[],externalReference:reference}),false);
});
