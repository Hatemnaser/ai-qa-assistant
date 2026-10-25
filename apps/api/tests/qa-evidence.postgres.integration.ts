import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,describe,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {createPrismaQaRequestRepository}=await import('../src/modules/qa-requests/qa-requests.repository.ts');
const {createPrismaAssetsRepository}=await import('../src/modules/assets/assets.repository.ts');
const {createAssetCleanupWorker}=await import('../src/modules/assets/assets.cleanup.ts');
const {createPrismaDataPortabilityRepository}=await import('../src/modules/data-portability/data-portability.repository.ts');
const {createProjectExportPackage}=await import('../src/modules/data-portability/export-package.ts');
const {validateProjectImportPackage}=await import('../src/modules/data-portability/import-package.ts');
const {readQaHistory}=await import('../src/modules/qa-requests/qa-report.reader.ts');
const {createQaRequestSchema,addQaEvidenceSchema}=await import('../src/modules/qa-requests/qa-requests.schema.ts');
const prefix='phase5-dbit-'+randomUUID(),ownerId=prefix+'-owner',otherId=prefix+'-other',projectId=prefix+'-project',now=new Date();
const actor={kind:'USER' as const,transport:'WEB' as const,userId:ownerId};let seq=0;const objectKeys:string[]=[];
before(async()=>{
 await prisma.user.createMany({data:[ownerId,otherId].map(id=>({id,email:id+'@example.test',passwordHash:'not-a-real-hash'}))});
 await prisma.project.create({data:{id:projectId,ownerId,name:'Phase 5 fixture'}});
});
after(async()=>{
 await prisma.project.deleteMany({where:{ownerId:{in:[ownerId,otherId]}}});
 await prisma.storedAsset.deleteMany({where:{ownerId:{in:[ownerId,otherId]}}});
 await prisma.objectDeletionJob.deleteMany({where:{objectKey:{in:objectKeys}}});
 await prisma.user.deleteMany({where:{id:{in:[ownerId,otherId]}}});
});
async function fixture(kind:'TEXT'|'SCREENSHOT'='TEXT'){
 const request=await prisma.qaRequest.create({data:{projectId,title:'Evidence '+ ++seq,objective:'Observe heading',target:'https://example.test',environment:'STAGING',phase:'RUNNING'}});
 const context=await prisma.qaContextSnapshot.create({data:{requestId:request.id,version:1,payload:{},sourceManifest:{},payloadHash:'a'.repeat(64),retrievalMode:'NONE'}});
 const artifact=await prisma.qaArtifact.create({data:{requestId:request.id,snapshotId:context.id,revision:1,origin:'AGENT_PROVIDED',title:'Heading',canonicalJson:{}}});
 const item=await prisma.qaChecklistItem.create({data:{artifactId:artifact.id,ordinal:0,title:'Heading',expectedResult:'Visible heading',evidenceRequirements:{create:{ordinal:0,kind,description:'Proof',required:true}}},include:{evidenceRequirements:true}});
 await prisma.qaRequest.update({where:{id:request.id},data:{selectedArtifactId:artifact.id}});
 const run=await prisma.qaRun.create({data:{requestId:request.id,artifactId:artifact.id,status:'ACTIVE',commitSha:'build-fixture'}});
 return {request,artifact,item,run,repository:createPrismaQaRequestRepository(prisma)};
}
async function asset(){const key=prefix+'/object-'+ ++seq;objectKeys.push(key);return prisma.storedAsset.create({data:{ownerId,projectId,objectKey:key,purpose:'QA_EVIDENCE',status:'READY',originalName:'proof.png',declaredMimeType:'image/png',detectedMimeType:'image/png',expectedSizeBytes:68,sizeBytes:68,checksumSha256:'a'.repeat(43)+'=',readyAt:now,evidenceExpiresAt:new Date(now.getTime()+86400000)}});}

describe('Phase 05 real evidence and archive fences',{concurrency:false},()=>{
 it('binds server target/build/expected/executor provenance to both result and evidence',async()=>{
  const f=await fixture(),scope={actor,projectId,requestId:f.request.id,runId:f.run.id};
  await f.repository.recordCheckResult({...scope,checklistItemId:f.item.id,status:'PASS',observedResult:'Heading seen',expectedVersion:1});
  await f.repository.addEvidence({...scope,checklistItemId:f.item.id,requirementId:f.item.evidenceRequirements[0]!.id,kind:'TEXT',textContent:'Heading seen',assetIds:[]});
  const result=await prisma.qaCheckResult.findFirstOrThrow({where:{runId:f.run.id}}),evidence=await prisma.qaEvidence.findFirstOrThrow({where:{runId:f.run.id}});
  assert.equal((result.provenance as {expectedResult:string}).expectedResult,'Visible heading');assert.equal((evidence.provenance as {build:{reference:string}}).build.reference,'build-fixture');
  assert.equal((evidence.provenance as {target:{url:string}}).target.url,'https://example.test/');
 });
 it('rejects expired READY image attachment and never rewrites its history',async()=>{
  const f=await fixture('SCREENSHOT'),a=await asset();await prisma.storedAsset.update({where:{id:a.id},data:{evidenceExpiresAt:new Date(0)}});
  await assert.rejects(()=>f.repository.addEvidence({actor,projectId,requestId:f.request.id,runId:f.run.id,checklistItemId:f.item.id,kind:'SCREENSHOT',assetIds:[a.id]}),{code:'ASSET_NOT_FOUND'});
  assert.equal(await prisma.qaEvidence.count({where:{runId:f.run.id}}),0);
 });
 it('expiry blocks review, preserves a descriptor, survives failed deletion and drains on retry',async()=>{
  const f=await fixture('SCREENSHOT'),a=await asset(),scope={actor,projectId,requestId:f.request.id,runId:f.run.id};
  await f.repository.recordCheckResult({...scope,checklistItemId:f.item.id,status:'PASS',observedResult:'Seen',expectedVersion:1});
  await f.repository.addEvidence({...scope,checklistItemId:f.item.id,requirementId:f.item.evidenceRequirements[0]!.id,kind:'SCREENSHOT',assetIds:[a.id],externalReference:'https://evidence.example.test/proof.png'});
  await prisma.storedAsset.update({where:{id:a.id},data:{evidenceExpiresAt:new Date(0)}});
  await f.repository.finishRun({...scope,expectedVersion:3});assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:f.request.id}})).phase,'EVIDENCE_NEEDED');
  await prisma.qaRequest.update({where:{id:f.request.id},data:{phase:'READY_FOR_REVIEW'}});
  await assert.rejects(()=>f.repository.reviewRun({...scope,decision:'APPROVED',expectedRunVersion:4}),{code:'EVIDENCE_REQUIRED'});
  let clock=new Date();let fail=true;const repo=createPrismaAssetsRepository(prisma),worker=createAssetCleanupWorker({repository:repo,now:()=>clock,batchSize:100,storage:{async deleteObject(){if(fail)throw Error('synthetic object-store interruption');}} as never});
  const failed=await worker.runOnce();assert.ok(failed.failed>0);
  const receipt=await prisma.qaEvidenceAsset.findFirstOrThrow({where:{assetId:null,evidence:{runId:f.run.id}}});assert.equal(receipt.unavailableReason,'EXPIRED');assert.equal((receipt.snapshot as {checksumSha256:string}).checksumSha256,a.checksumSha256);
  assert.ok(await prisma.objectDeletionJob.findUnique({where:{objectKey:a.objectKey}}));
  clock=new Date(clock.getTime()+120000);fail=false;const done=await worker.runOnce();assert.ok(done.deleted>0);assert.equal(await prisma.storedAsset.findUnique({where:{id:a.id}}),null);assert.ok(await prisma.qaEvidenceAsset.findUnique({where:{id:receipt.id}}));
 });
 it('linked screenshots satisfy finish and review without uploading a local binary',async()=>{
  const f=await fixture('SCREENSHOT'),scope={actor,projectId,requestId:f.request.id,runId:f.run.id};
  await f.repository.recordCheckResult({...scope,checklistItemId:f.item.id,status:'PASS',observedResult:'Seen',expectedVersion:1});
  const input=addQaEvidenceSchema.parse({kind:'SCREENSHOT',checklistItemId:f.item.id,requirementId:f.item.evidenceRequirements[0]!.id,externalReference:'HTTPS://evidence.example.test/proof.png'});
  await f.repository.addEvidence({...scope,...input});
  await f.repository.finishRun({...scope,expectedVersion:3});
  assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:f.request.id}})).phase,'READY_FOR_REVIEW');
  await f.repository.reviewRun({...scope,decision:'APPROVED',expectedRunVersion:4});
  assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:f.request.id}})).phase,'APPROVED');
 });
 it('invalid historical screenshot references cannot fulfill required evidence',async()=>{
  const f=await fixture('SCREENSHOT'),scope={actor,projectId,requestId:f.request.id,runId:f.run.id};
  await f.repository.recordCheckResult({...scope,checklistItemId:f.item.id,status:'PASS',observedResult:'Seen',expectedVersion:1});
  await prisma.qaEvidence.create({data:{runId:f.run.id,checklistItemId:f.item.id,requirementId:f.item.evidenceRequirements[0]!.id,kind:'SCREENSHOT',actorKind:'USER',transport:'WEB',externalReference:'https://user:password@evidence.example.test/proof.png'}});
  await f.repository.finishRun({...scope,expectedVersion:2});
  assert.equal((await prisma.qaRequest.findUniqueOrThrow({where:{id:f.request.id}})).phase,'EVIDENCE_NEEDED');
 });
 it('records and exports all 500 supported environment characters without truncation',async()=>{
  const input=createQaRequestSchema.parse({title:'Environment fixture',objective:'Observe heading',environment:'Staging description; '.repeat(25).slice(0,499),checklistMode:'AGENT_PROVIDED'});
  assert.equal(input.environment?.length,499);
  const environment=input.environment+'!';
  assert.equal(createQaRequestSchema.parse({...input,environment}).environment,environment);
  const f=await fixture(),scope={actor,projectId,requestId:f.request.id,runId:f.run.id};
  await prisma.qaRequest.update({where:{id:f.request.id},data:{environment}});
  await f.repository.recordCheckResult({...scope,checklistItemId:f.item.id,status:'PASS',observedResult:'Seen',expectedVersion:1});
  await f.repository.addEvidence({...scope,checklistItemId:f.item.id,requirementId:f.item.evidenceRequirements[0]!.id,kind:'TEXT',textContent:'Seen',assetIds:[]});
  const history=await prisma.$transaction(tx=>readQaHistory(tx,ownerId,projectId,new Date(),f.request.id)),request=history.requests[0]!;
  assert.equal(request.environment,environment);assert.equal(request.runs[0]?.results[0]?.provenance?.target.environment,environment);assert.equal(request.runs[0]?.evidence[0]?.provenance?.target.environment,environment);
 });
 it('reads QA history only through the owner scope and fails before huge text materialization',async()=>{
  const f=await fixture();const other=await prisma.$transaction(tx=>readQaHistory(tx,otherId,projectId));assert.equal(other.requests.length,0);
  await prisma.qaRequest.update({where:{id:f.request.id},data:{objective:'x'.repeat(2*1024*1024+1)}});
  await assert.rejects(()=>prisma.$transaction(tx=>readQaHistory(tx,ownerId,projectId)),{code:'QA_EXPORT_TOO_LARGE'});
  await prisma.qaRequest.update({where:{id:f.request.id},data:{objective:'Restored fixture objective'}});
 });
 it('imports and re-exports QA history without creating executable requests, authorizations or approvals',async()=>{
  const repo=createPrismaDataPortabilityRepository(prisma),source=await repo.findOwnedProjectExportData(ownerId,projectId,false);assert.ok(source);
  const pkg=createProjectExportPackage(source,{includeChats:false}),parsed=validateProjectImportPackage(pkg.archive);
  const restored=await repo.createImportedProject(ownerId,parsed);assert.equal(await prisma.qaRequest.count({where:{projectId:restored.projectId}}),0);assert.equal(await prisma.qaExecutionJob.count({where:{projectId:restored.projectId}}),0);
  assert.equal(await prisma.qaImportedArchive.count({where:{projectId:restored.projectId}}),1);
  const again=await repo.findOwnedProjectExportData(ownerId,restored.projectId,false);assert.ok(again?.qaHistory?.requests.length);assert.ok(again.qaHistory.requests.every(r=>r.recordOrigin==='IMPORTED_RECORD'));
 });
});
