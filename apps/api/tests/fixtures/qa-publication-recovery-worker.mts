import assert from 'node:assert/strict';
import {assertPostgresIntegrationTarget} from '../helpers/postgresIntegrationTarget.ts';

assertPostgresIntegrationTarget(process.env);
const payload=JSON.parse(process.argv[2]) as {
 mode:'pauseBeforePublication'|'recover';
 requestId:string;
};
const {prisma}=await import('../../src/db/prisma.ts');
const {createPrismaUsageRepository}=await import('../../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../../src/modules/usage/usage.service.ts');
const {createQaChecklistIntelligence}=await import('../../src/modules/qa-requests/qa-checklist.intelligence.ts');
const {createQaProcessingHandlers}=await import('../../src/modules/qa-requests/qa-processing.handlers.ts');
const {createQaProcessingWorker}=await import('../../src/modules/qa-requests/qa-processing.worker.ts');
const {createQaProcessingRepository}=await import('../../src/modules/qa-requests/qa-processing.repository.ts');
const {createPrismaQaRequestRepository}=await import('../../src/modules/qa-requests/qa-requests.repository.ts');

const usage=createUsageService({repository:createPrismaUsageRepository(prisma)});
const intelligence=createQaChecklistIntelligence({
 model:'gemini-3.1-flash-lite',provider:'gemini',usage,
 async generateText(input){
  process.send?.({providerCall:true});
  return {
   model:input.model!,provider:input.provider!,
   text:JSON.stringify({title:'Result lost with process',items:[{title:'Page opens',steps:['Open page'],expectedResult:'Page visible',evidenceRequirements:[{kind:'TEXT',description:'Observed page'}]}]}),
   usage:{totalTokens:2000},
  };
 },
});
const handlers=createQaProcessingHandlers({
 database:prisma,
 repository:createPrismaQaRequestRepository(prisma),
 generator:{
  async generate(input){
   assert.equal(input.requestId,payload.requestId,'The fixture must claim its own request');
   const result=await intelligence.generate(input);
   if(payload.mode==='pauseBeforePublication'){
    // Tracked generation and its real receipt transaction have finished. Keep
    // only the generated value in this process, before repository publication.
    process.send?.({stage:'before_publication',requestId:input.requestId});
    await new Promise<never>(()=>{});
   }
   return result;
  },
 },
});
const worker=createQaProcessingWorker({
 handlers:{CHECKLIST_GENERATION:handlers.CHECKLIST_GENERATION},
 repository:createQaProcessingRepository(prisma),
 leaseMs:60_000,providerTimeoutMs:120_000,maxAttempts:3,random:()=>0,
});
try{
 const result=await worker.runOnce({concurrency:1});
 process.send?.({stage:'completed',requestId:payload.requestId,result});
}finally{
 await prisma.$disconnect();
 process.disconnect?.();
}
