import {randomUUID} from 'node:crypto';
import type {prisma} from '../../src/db/prisma.ts';
import {profileManifestV2Schema,recipeBundleV1Schema,targetDefinitionSchema} from '@oddpath/qa-execution-contract';
import {createQaTargetsRepository} from '../../src/modules/qa-targets/qa-targets.repository.ts';
import {resolveProfileManifest} from '../../src/modules/qa-requests/qa-execution-recipes.repository.ts';
import {hashCanonicalJson} from '../../src/lib/canonical-json.ts';

export async function quotaBrowserFixture(db:typeof prisma,ownerId:string,time:Date){
 const key=randomUUID(),project=await db.project.create({data:{ownerId,name:'Quota fixture '+key}});
 const actor={kind:'USER' as const,transport:'WEB' as const,userId:ownerId};
 const targets=createQaTargetsRepository(db,()=>time);
 const target=await targets.create({userId:ownerId,projectId:project.id,label:'Quota staging',definition:targetDefinitionSchema.parse({baseUrl:'https://staging.example.com',environmentKind:'STAGING'})});
 const proof=await targets.challenge({projectId:project.id,targetId:target.targetId,expectedRevision:1,method:'DNS_TXT',challengeHash:hashCanonicalJson(key),expiresAt:new Date(time.getTime()+600_000)});
 await targets.confirm({projectId:project.id,targetId:target.targetId,revisionId:target.revisionId,verificationId:proof.id,verifiedAt:time,validUntil:new Date(time.getTime()+86_400_000)});
 const profile=resolveProfileManifest(profileManifestV2Schema.parse({schemaVersion:2,profileKey:'staging',label:'Staging',environmentKind:'STAGING',target,authentication:{kind:'NONE'},executionLimits:{preparationTimeoutMs:300_000,executionTimeoutMs:600_000},executorKey:'playwright',evidenceKinds:['TEXT'],recipeSchemaVersions:[1],valueReferences:[]}));
 const request=await db.qaRequest.create({data:{projectId:project.id,title:'Quota check',objective:'Check heading',phase:'READY_TO_RUN'}});
 const snapshot=await db.qaContextSnapshot.create({data:{requestId:request.id,version:1,payload:{},sourceManifest:{},payloadHash:'quota-test',retrievalMode:'NONE'}});
 const artifact=await db.qaArtifact.create({data:{requestId:request.id,snapshotId:snapshot.id,revision:1,origin:'AGENT_PROVIDED',title:'Heading checklist',canonicalJson:{}}});
 const item=await db.qaChecklistItem.create({data:{artifactId:artifact.id,ordinal:0,title:'Heading',expectedResult:'Heading visible',evidenceRequirements:{create:{ordinal:0,description:'Record the heading',kind:'TEXT',required:true}}}});
 const canonicalJson=recipeBundleV1Schema.parse({schemaVersion:1,engine:'playwright',items:[{checklistItemId:item.id,steps:[{action:'navigate',path:'/',ref:'open',waitUntil:'domcontentloaded'},{action:'expect',ref:'heading',expectation:{kind:'visible',locator:{by:'role',role:'heading',name:'Home'}}}]}]});
 const recipe=await db.qaExecutionRecipe.create({data:{requestId:request.id,artifactId:artifact.id,revision:1,origin:'AGENT_PROVIDED',executorKey:'playwright',title:'Heading recipe',canonicalJson,recipeHash:hashCanonicalJson(canonicalJson),profileManifest:profile,profileManifestHash:profile.manifestHash,transport:'WEB',assessments:{create:{status:'PASSED',suggestions:[]}}}});
 await db.qaRequest.update({where:{id:request.id},data:{selectedArtifactId:artifact.id}});
 const connection=await db.projectConnectionToken.create({data:{projectId:project.id,ownerId,name:'Quota runner',tokenPrefix:key,tokenHash:hashCanonicalJson(key),scopes:['qa:read','execution:claim','execution:write']}});
 const runner=await db.qaRunnerRegistration.create({data:{projectId:project.id,connectionTokenId:connection.id,instanceId:key,displayName:'Quota runner',runnerVersion:'0.2-test',protocolVersions:[2],executorKeys:['playwright'],publicProfiles:[profile],lastSeenAt:time}});
 return {project,request,connection,runner,actor,
  start:{actor,projectId:project.id,requestId:request.id,expectedRequestVersion:request.version,profileKey:profile.profileKey,recipeId:recipe.id,recipeHash:recipe.recipeHash,runnerRegistrationId:runner.id,confirmProduction:false},
  claim:{actor:{...actor,kind:'INTEGRATION' as const,transport:'REST' as const,connectionTokenId:connection.id},connectionTokenId:connection.id,protocolVersion:2 as const,request:{instanceId:key,registrationId:runner.id},leaseToken:'t'.repeat(43),leaseExpiresAt:new Date(time.getTime()+45_000)},
 };
}
