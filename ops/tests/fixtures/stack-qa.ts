import {randomUUID,createHash} from 'node:crypto';
import {managedProjectToken} from '../../../apps/api/src/modules/browser-runtime/managed-project-identity.ts';
// Synthetic data only. The harness transpiles this and the existing shared
// quotaBrowserFixture for execution inside the CURRENT compiled API image.
import {prisma as db} from '../../../apps/api/src/db/prisma.ts';
import {env} from '../../../apps/api/src/config/env.ts';
import {hashPassword} from '../../../apps/api/src/modules/auth/auth.security.ts';
import {createQaTargetsRepository} from '../../../apps/api/src/modules/qa-targets/qa-targets.repository.ts';
import {hashCanonicalJson} from '../../../apps/api/src/lib/canonical-json.ts';
import {loadBrowserAuthVault,closeBrowserAuthVault} from '../../../apps/api/src/modules/browser-auth/browser-auth.vault.ts';
import {quotaBrowserFixture} from '../../../apps/api/tests/helpers/quotaBrowserFixture.ts';
import {DatabaseSync} from 'node:sqlite';
const input=JSON.parse(process.env.ODDPATH_STACK_INPUT||'{}');
try {
 if(input.phase==='owner'){
  await db.user.create({data:{id:'stack-owner',email:'stack@example.test',passwordHash:await hashPassword(input.password),emailVerifiedAt:new Date(),acceptedTermsAt:new Date(),acceptedTermsVersion:env.currentTermsVersion}});
  await db.chat.create({data:{id:'stack-chat',userId:'stack-owner',title:'Durable synthetic stack chat'}});
  console.log(JSON.stringify({owner:'stack-owner',email:'stack@example.test'}));
 }
 if(input.phase==='closed-negative'){
  const id='closed-outsider';await db.user.create({data:{id,email:'outside@example.test',passwordHash:await hashPassword(input.password),emailVerifiedAt:new Date(),acceptedTermsAt:new Date(),acceptedTermsVersion:env.currentTermsVersion}});
  const outside=await quotaBrowserFixture(db,id,new Date()),legacy=await quotaBrowserFixture(db,'stack-owner',new Date());
  const identity={id:'mb-'+randomUUID(),projectId:outside.project.id,ownerId:id,managedHostId:env.qaManagedHostId};
  const token=managedProjectToken(identity);const binding=await db.projectConnectionToken.create({data:{...identity,name:'Preexisting excluded binding',tokenHash:createHash('sha256').update(token).digest('hex'),tokenPrefix:token.slice(0,20),scopes:['qa:read','execution:claim','execution:write']}});
  await db.qaRunnerRegistration.update({where:{id:outside.runner.id},data:{connectionTokenId:binding.id}});
  const result=(f:typeof outside)=>({projectId:f.project.id,requestId:f.request.id,body:{executionMode:'PLAYWRIGHT',expectedRequestVersion:f.start.expectedRequestVersion,profileKey:f.start.profileKey,recipeId:f.start.recipeId,recipeHash:f.start.recipeHash,runnerRegistrationId:f.runner.id}});
  console.log(JSON.stringify({outside:result(outside),legacy:result(legacy)}));
 }
 if(input.phase==='qa'){
  const f=await quotaBrowserFixture(db,'stack-owner',new Date()),targets=createQaTargetsRepository(db);
  const old=await db.qaTarget.findFirstOrThrow({where:{projectId:f.project.id}});
  const target=await targets.revise({userId:'stack-owner',projectId:f.project.id,targetId:old.id,expectedRevision:1,label:'Synthetic stack public target',definition:{baseUrl:'https://example.com/',environmentKind:'STAGING',resourceOrigins:[],authenticationOrigins:[],candidate:null}});
  const proof=await targets.challenge({projectId:f.project.id,targetId:target.targetId,expectedRevision:2,method:'DNS_TXT',challengeHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000)});
  await targets.confirm({projectId:f.project.id,targetId:target.targetId,revisionId:target.revisionId,verificationId:proof.id,verifiedAt:new Date(),validUntil:new Date(Date.now()+86400000)});
  const chat=await db.chat.create({data:{userId:'stack-owner',projectId:f.project.id,kind:'TEST',title:'Synthetic stack session',testSession:{create:{currentRequestId:f.request.id}}}});
  await db.qaRequest.update({where:{id:f.request.id},data:{testSessionId:chat.id}});
  console.log(JSON.stringify({projectId:f.project.id,sessionId:chat.id,requestId:f.request.id,recipeId:f.start.recipeId}));
 }
 if(input.phase==='prepare'){
  const registration=await db.qaRunnerRegistration.findFirst({where:{projectId:input.projectId,connectionToken:{managedHostId:env.qaManagedHostId}}});
  if(!registration){console.log(JSON.stringify({pending:true}));}
  else{
   const profile=(registration.publicProfiles as any[]).find(p=>p.authentication.kind==='MANUAL');if(!profile)throw Error('No managed MANUAL profile');
   const recipe=await db.qaExecutionRecipe.findUniqueOrThrow({where:{id:input.recipeId}}),bundle=recipe.canonicalJson as any;
   bundle.items[0].steps[1].expectation.locator={by:'text',value:'This domain is for use in documentation examples'};
   const recipeHash=hashCanonicalJson(bundle);
   await db.qaExecutionRecipe.update({where:{id:recipe.id},data:{canonicalJson:bundle,recipeHash,profileManifest:profile,profileManifestHash:profile.manifestHash}});
   await db.qaExecutionRecipeItem.createMany({data:bundle.items.map((item:any,ordinal:number)=>({recipeId:recipe.id,checklistItemId:item.checklistItemId,steps:item.steps,ordinal,recipeHash:hashCanonicalJson(item)}))});
   const request=await db.qaRequest.findUniqueOrThrow({where:{id:input.requestId}});
   console.log(JSON.stringify({body:{executionMode:'PLAYWRIGHT',expectedRequestVersion:request.version,profileKey:profile.profileKey,recipeId:recipe.id,recipeHash,runnerRegistrationId:registration.id}}));
  }
 }
 if(input.phase==='state'){
  const job=await db.qaExecutionJob.findFirst({where:{projectId:input.projectId},include:{browserRuntime:true,run:{include:{results:true,evidence:true}}}});
  const reservation=job?await db.qaBrowserReservation.findUnique({where:{executionId:job.id}}):null;
  console.log(JSON.stringify({job,reservation}));
 }
 if(input.phase==='mark-vault'){
  const v=loadBrowserAuthVault(false),now=Date.now();v.revocations.issue({id:'stack-revoked',ownerId:'stack-owner',projectId:'stack-scope',targetRevisionId:'synthetic',targetHash:'synthetic',createdAt:now,expiresAt:now+600000});v.revocations.revoke('stack-revoked',now);
  console.log(JSON.stringify({marked:true}));
 }
 if(input.phase==='check-vault'){
  const vault=loadBrowserAuthVault(false),journal=new DatabaseSync(env.qaBrowserVaultRevocationFile,{readOnly:true});
  const row=journal.prepare('SELECT payload FROM entries WHERE id=?').get('stack-revoked') as {payload:string}|undefined;journal.close();
  if(!row)throw Error('Durable revocation entry disappeared');const binding=JSON.parse(row.payload);
  const denied=!vault.revocations.allows(binding,Date.now()); // Also verifies its MAC; corruption throws.
  let refused=false;try{vault.revocations.issue(binding);}catch{refused=true;}
  console.log(JSON.stringify({retainedRevocation:refused&&denied&&Number.isFinite(binding.revokedAt)}));
 }
}finally{closeBrowserAuthVault();await db.$disconnect();}
