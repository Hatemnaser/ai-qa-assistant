import {assertPostgresIntegrationTarget} from '../helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const payload=JSON.parse(process.argv[2]);
if(payload.operation==='http'){
 process.env.AI_ENABLED='true';process.env.GUEST_AI_ENABLED='true';process.env.GEMINI_API_KEY='offline-recovery-test-only';process.env.AI_WORKFLOW_ROUTER_ENABLED='false';
 globalThis.fetch=async url=>{
  if(!String(url).includes('generativelanguage.googleapis.com/'))throw new Error('Unexpected outbound request in offline fixture');
  process.send?.({providerCall:true});
  return Response.json({candidates:[{content:{role:'model',parts:[{text:'Offline successful response'}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:1000,totalTokenCount:2000}});
 };
}
const {prisma}=await import('../../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../../src/modules/usage/usage.repository.ts');
const now=()=>new Date(payload.time);
const repo=createPrismaUsageRepository(prisma,now);
if(payload.operation==='http'){
 const {createApp}=await import('../../src/app.ts');
 const {createCsrfToken}=await import('../../src/middleware/csrf.middleware.ts');
 const {env}=await import('../../src/config/env.ts');
 if(payload.recover)await repo.reconcileExpiredUsage!();
 const server=createApp().listen(0,'127.0.0.1',()=>{
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test address');
  process.send?.({ready:true,port:address.port,csrf:createCsrfToken(),csrfCookie:env.csrfCookieName,csrfHeader:env.csrfHeaderName});
 });
}else if(payload.operation==='browser'||payload.operation==='claimOnly'){
 const {createQaExecutionRepository}=await import('../../src/modules/qa-requests/qa-execution.repository.ts');
 const {createBrowserRuntimeRepository}=await import('../../src/modules/browser-runtime/browser-runtime.repository.ts');
 payload.claim.leaseExpiresAt=new Date(payload.claim.leaseExpiresAt);
 const execution=createQaExecutionRepository(prisma,now,{allowV2:true,requireRuntime:true});
 const claimed=await execution.claim(payload.claim);
 if(!claimed)throw new Error('fixture was not claimed');
 if(payload.operation==='browser')await createBrowserRuntimeRepository(prisma,now).begin(payload.connectionId,payload.executionId,claimed.claim,{runtimeId:payload.runtimeId,imageDigest:'sha256:'+'a'.repeat(64)});
 process.send?.({ready:true,claim:claimed.claim});
}else if(payload.operation==='begin') {
 await repo.beginUsageAttempt!(payload.eventId);
 process.send?.({ready:true});
}else{
 await prisma.$transaction(async tx=>{
  await tx.usageProviderAttempt.updateMany({where:{eventId:payload.eventId},data:{creditsUsed:7,status:'completed'}});
  process.send?.({ready:true});
  await new Promise(()=>{});
 },{timeout:60000});
}
setInterval(()=>{},1000);

