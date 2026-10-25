import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {env} from '../src/config/env.ts';
import {AppError} from '../src/lib/errors.ts';
import {createChatService} from '../src/modules/chat/chat.service.ts';
import {resolveAiModel} from '../src/modules/ai/provider-registry.ts';
import {routeAiModel} from '../src/modules/ai/routing/model-router.ts';
import {analyzeQaWorkflow} from '../src/modules/ai/qa-workflow.ts';
import type {ChatUsageCompletionInput,ChatUsageFailureInput} from '../src/modules/usage/usage.service.ts';
const request={history:[],message:'Review login',mode:'general' as const};
async function configuredCase(configuration:Record<string,string>,body:string){
 const program=`import assert from 'node:assert/strict';
 import {AppError} from ${JSON.stringify(new URL('../src/lib/errors.ts',import.meta.url).href)};
 import {createChatService} from ${JSON.stringify(new URL('../src/modules/chat/chat.service.ts',import.meta.url).href)};
 import {routeAiModel} from ${JSON.stringify(new URL('../src/modules/ai/routing/model-router.ts',import.meta.url).href)};
 import {resolveAiModel} from ${JSON.stringify(new URL('../src/modules/ai/provider-registry.ts',import.meta.url).href)};
 import {analyzeQaWorkflow} from ${JSON.stringify(new URL('../src/modules/ai/qa-workflow.ts',import.meta.url).href)};
 ${body}`;
 // Env is deliberately frozen; exercise configuration in a fresh process.
 await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',program],{
  cwd:fileURLToPath(new URL('../../..',import.meta.url)),env:{...process.env,...configuration,NODE_ENV:'test',GEMINI_API_KEY:''},timeout:15000,maxBuffer:1024*1024,
 });
}
describe('explicit and Auto model contracts',()=>{
 for(const code of ['QUOTA_EXCEEDED','MODEL_UNAVAILABLE'])it(`explicit ${code} uses one model attempt and records its failure`,async()=>{
  const calls:string[]=[];let failure:ChatUsageFailureInput|undefined;
  const service=createChatService({chatWithAi:async input=>{calls.push(input.model!);throw new AppError('synthetic model failure',503,code);},
   reserveUsage:async()=>({eventId:'explicit',unit:'credits',limit:100,used:1,remaining:99,reserved:1}),recordUsageAttempt:async()=>{},
   failUsage:async(reservation,input)=>{failure=input;return reservation;}});
  await assert.rejects(()=>service.createChatReply({...request,model:'gemini-2.5-flash'}),{code});
  assert.deepEqual(calls,['gemini-2.5-flash']);assert.equal(failure?.providerAttempts,1);assert.equal(failure?.model,'gemini-2.5-flash');
 });
 it('image input and visual output preference cannot change an explicit model',async()=>{
  const service=createChatService({chatWithAi:async input=>{assert.equal(input.model,'gemini-3.1-flash-lite');return {reply:'Seen',model:input.model!,provider:input.provider};}});
  const response=await service.createChatReply({...request,mode:'screenshot_review',model:'gemini-3.1-flash-lite',attachments:[{type:'image',mimeType:'image/png',data:'abc'}]});
  assert.equal(response.modelRouting.requestedModel,'gemini-3.1-flash-lite');assert.equal(response.modelRouting.source,'requested');
 });
 it('omitted legacy selection keeps the concrete default and cannot opt in to fallback',async()=>{
  const calls:string[]=[];
  const service=createChatService({chatWithAi:async input=>{calls.push(input.model!);throw new AppError('Unavailable',503,'MODEL_UNAVAILABLE');}});
  await assert.rejects(()=>service.createChatReply(request),{code:'MODEL_UNAVAILABLE'});assert.deepEqual(calls,['gemini-3.1-flash-lite']);
 });
 it('Auto reconciles actual model, tokens and every attempted generation',async()=>{
  const calls:string[]=[];let completion:ChatUsageCompletionInput|undefined;let attempts=0;
  const service=createChatService({chatWithAi:async input=>{calls.push(input.model!);if(calls.length===1)throw new AppError('Unavailable',503,'MODEL_UNAVAILABLE');return {reply:'Ready',model:input.model!,provider:input.provider,usage:{inputTokens:100,outputTokens:50,totalTokens:150}};},
   reserveUsage:async(_identity,estimate)=>{assert.notEqual(estimate.model,'auto');return {eventId:'auto',unit:'credits',limit:100,used:5,remaining:95,reserved:5};},
   recordUsageAttempt:async()=>{attempts++;},completeUsage:async(reservation,input)=>{completion=input;assert.equal(reservation.providerAttempts,2);return reservation;}});
  const response=await service.createChatReply({...request,model:'auto'});
  assert.deepEqual(calls,['gemini-3.1-flash-lite','gemini-2.5-flash-lite']);assert.equal(attempts,2);
  assert.equal(response.modelRouting.requestedModel,'auto');assert.equal(response.modelRouting.source,'fallback');assert.equal(response.modelRouting.selectedModel,response.model);
  assert.equal(completion?.model,response.model);assert.equal(completion?.totalTokens,150);assert.equal(completion?.modelRoutingSource,'fallback');
 });
 it('invalid fallback configuration is rejected before the application starts',async()=>{
  await assert.rejects(()=>configuredCase({AI_FALLBACK_MODEL:'removed-model'},'assert.fail("Invalid configuration must not start")'),/Unsafe AI configuration.*AI_FALLBACK_MODEL/u);
 });
 it('Auto exhaustion never repeats a model and records the final attempted model',async()=>{
  const calls:string[]=[];let lastFailure:ChatUsageFailureInput|undefined;
  const service=createChatService({chatWithAi:async input=>{calls.push(input.model!);throw new AppError('Unavailable',503,'MODEL_UNAVAILABLE');},
   reserveUsage:async()=>({eventId:'exhausted',unit:'credits',limit:100,used:5,remaining:95,reserved:5}),recordUsageAttempt:async()=>{},
   failUsage:async(reservation,input)=>{lastFailure=input;return reservation;}});
  await assert.rejects(()=>service.createChatReply({...request,model:'auto'}),{code:'MODEL_UNAVAILABLE'});
  assert.equal(calls.length,3);assert.equal(new Set(calls).size,calls.length);assert.ok(!calls.includes('auto'));
  assert.equal(lastFailure?.providerAttempts,3);assert.equal(lastFailure?.model,calls.at(-1));
 });
 for(const code of ['AI_DISABLED','USAGE_LIMIT_REACHED','AI_PROVIDER_ERROR','MISSING_API_KEY'])it(`Auto never falls back on ${code}`,async()=>{
  let calls=0;const service=createChatService({chatWithAi:async()=>{calls++;throw new AppError('Failure',503,code);}});
  await assert.rejects(()=>service.createChatReply({...request,model:'auto'}),{code});assert.equal(calls,1);
 });
 for(const model of ['gemini-2.5-flash','auto'])it(`${model} rejects mismatched provider response without a new attempt`,async()=>{
  let calls=0;const service=createChatService({chatWithAi:async input=>{calls++;return {reply:'Wrong model',model:input.model==='gemini-2.5-flash'?'gemini-3.1-flash-lite':'gemini-2.5-flash',provider:input.provider};}});
  await assert.rejects(()=>service.createChatReply({...request,model}),{code:'AI_MODEL_MISMATCH'});assert.equal(calls,1);
 });
 it('Auto chooses a compatible registered model if the configured policy has incompatible capabilities',()=>{
  const workflow=analyzeQaWorkflow({message:'Review an image',mode:'general',hasImage:true}),base=resolveAiModel();
  const result=routeAiModel({hasImage:true,hasTextAttachment:false,requestedModel:base,requestedSelection:'auto',workflow,
   resolveModel:input=>{const resolved=resolveAiModel(input);return input?.model===env.aiVisualModel?{...resolved,config:{...resolved.config,capabilities:{images:false,text:true,textAttachments:true}}}:resolved;}});
  assert.equal(result.model.config.capabilities.images,true);assert.notEqual(result.model.model,env.aiVisualModel);assert.equal(result.routing.requestedModel,'auto');
 });
 it('disabling the Auto policy router never changes an explicit choice',async()=>{
  await configuredCase({AI_MODEL_ROUTER_ENABLED:'false'},`
   const workflow=analyzeQaWorkflow({message:'Review',hasImage:true});
   const result=routeAiModel({hasImage:true,hasTextAttachment:false,requestedModel:resolveAiModel({model:'gemini-2.5-flash-lite'}),workflow,resolveModel:resolveAiModel});
   assert.equal(result.model.model,'gemini-2.5-flash-lite');assert.equal(result.routing.source,'requested');
   const auto=routeAiModel({hasImage:false,hasTextAttachment:false,requestedModel:resolveAiModel(),requestedSelection:'auto',workflow,resolveModel:resolveAiModel});
   assert.equal(auto.routing.requestedModel,'auto');assert.equal(auto.model.model,'gemini-3.1-flash-lite');
  `);
 });
});
