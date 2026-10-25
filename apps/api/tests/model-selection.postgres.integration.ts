import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {before,after,describe,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
import type {Prisma} from '../src/generated/prisma/client.ts';
import type {ValidatedNativeAccountImport} from '../src/modules/data-portability/account-import.types.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {AppError}=await import('../src/lib/errors.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {createTestSessionIntelligence}=await import('../src/modules/test-sessions/test-sessions.intelligence.ts');
const {createTestSessionsRepository}=await import('../src/modules/test-sessions/test-sessions.repository.ts');
const {createTestSessionsWorker}=await import('../src/modules/test-sessions/test-sessions.worker.ts');
const {createChatHistoryService}=await import('../src/modules/chat-history/chat-history.service.ts');
const {createPrismaChatHistoryRepository}=await import('../src/modules/chat-history/chat-history.repository.ts');
const {storedChatSchema}=await import('../src/modules/chat-history/chat-history.schema.ts');
const {createFakeProjectAccess}=await import('./helpers/projectAccess.ts');
const {sessionsService}=await import('../src/modules/sessions/sessions.service.ts');
const {createPrismaAccountImportRepository}=await import('../src/modules/data-portability/account-import.repository.ts');
const ownerId='model-dbit-'+randomUUID(),repository=createTestSessionsRepository(prisma);
describe('Phase 06A durable session model choice',{concurrency:false},()=>{
 before(async()=>{await prisma.user.create({data:{id:ownerId,email:ownerId+'@example.test'}});});
 after(async()=>{await prisma.user.delete({where:{id:ownerId}});});
 it('unknown and original imported models survive account save and reload in PostgreSQL',async()=>{
  const chatId='model-history-'+randomUUID(),service=createChatHistoryService({repository:createPrismaChatHistoryRepository(prisma),projectAccess:createFakeProjectAccess()});
  const input=storedChatSchema.parse({id:chatId,model:'auto',messages:[
   {id:'unknown-'+randomUUID(),role:'assistant',content:'Unknown'},
   {id:'known-'+randomUUID(),role:'assistant',content:'Known',model:'retired-model'},
  ]});
  await service.saveUserChat(ownerId,input);
  const first=(await service.listUserChats(ownerId)).find(chat=>chat.id===chatId)!;
  assert.equal(first.model,'auto');assert.deepEqual(first.messages.map(message=>message.model),['','retired-model']);
  await prisma.message.update({where:{id:first.messages[0].id},data:{model:'gemini-3.1-flash-lite',metadata:{imported:{originalModel:null}}}});
  const historical=(await service.listUserChats(ownerId)).find(chat=>chat.id===chatId)!;
  assert.equal(historical.messages[0].model,'');
  await service.saveUserChat(ownerId,storedChatSchema.parse(historical));
  const restored=(await service.listUserChats(ownerId)).find(chat=>chat.id===chatId)!;
  assert.deepEqual(restored.messages.map(message=>message.model),['','retired-model']);
 });
 it('unified session reads retain original models and failed-message flags without rewriting history',async()=>{
  const chatId='model-unified-history-'+randomUUID(),service=createChatHistoryService({repository:createPrismaChatHistoryRepository(prisma),projectAccess:createFakeProjectAccess()});
  const model='gemini-3.1-flash-lite';
  const input=storedChatSchema.parse({id:chatId,model,messages:[
   {id:'legacy-unknown-'+randomUUID(),role:'assistant',content:'Imported unknown source',model},
   {id:'legacy-external-'+randomUUID(),role:'assistant',content:'Imported external source',model},
   {id:'failed-'+randomUUID(),role:'assistant',content:'Imported failed request',model,isError:true},
   {id:'successful-'+randomUUID(),role:'assistant',content:'Successful known response',model:'gemini-2.5-flash'},
   {id:'missing-'+randomUUID(),role:'assistant',content:'Unrecorded model'},
  ].map((message,index)=>({...message,createdAt:new Date(1700000000000+index).toISOString()}))});
  await service.saveUserChat(ownerId,input);
  // Reproduce the old external import rows, whose source provenance is retained.
  await prisma.message.update({where:{id:input.messages[0].id},data:{metadata:{imported:{provider:'chatgpt',originalModel:null}}}});
  await prisma.message.update({where:{id:input.messages[1].id},data:{metadata:{imported:{provider:'chatgpt',originalModel:'gpt-source-model'}}}});
  await prisma.message.update({where:{id:input.messages[4].id},data:{model:null}});
  const rowsBefore=await prisma.message.findMany({where:{chatId},orderBy:{createdAt:'asc'}});
  const history=(await service.listUserChats(ownerId)).find(chat=>chat.id===chatId)!;
  const session=await sessionsService.read(ownerId,chatId);
  assert.deepEqual(session.messages.map(message=>message.model),['','gpt-source-model',model,'gemini-2.5-flash','']);
  assert.deepEqual(session.messages.map(message=>({model:message.model,isError:message.isError})),history.messages.map(message=>({model:message.model,isError:message.isError})));
  assert.equal(session.messages[2].isError,true);assert.equal(session.messages[3].isError,undefined);
  assert.equal(session.managed,false);assert.equal(session.currentRequestId,null);assert.deepEqual(session.requests,[]);
  await assert.rejects(()=>sessionsService.read('another-owner',chatId),{code:'TEST_SESSION_NOT_FOUND'});
  assert.deepEqual(await prisma.message.findMany({where:{chatId},orderBy:{createdAt:'asc'}}),rowsBefore);
  // The browser regression consumes this real service DTO, not importer output.
  if(process.env.ODDPATH_MODEL_HISTORY_DTO_FILE)await writeFile(process.env.ODDPATH_MODEL_HISTORY_DTO_FILE,JSON.stringify({session},null,2));
 });
 it('native account import retains recorded models through both readers and validated resave',async()=>{
  const time=new Date('2026-10-01T12:00:00Z'),title='native-model-history-'+randomUUID();
  const models=['gemini-2.5-flash','gpt-source-model',null,'gemini-3.1-flash-lite'];
  const contents=['Native archive known Gemini response','Native archive known external response','Native archive unknown response','Native archive failed request'];
  const input:ValidatedNativeAccountImport={importKind:'account_archive',packageDigest:'a'.repeat(64),sourceAccountId:'synthetic-source',projects:[],accountMemories:[],binaryAssets:[],warnings:[],chats:[{
   sourceId:'source-chat',sourceProjectId:null,title,mode:'general',model:'gemini-3.1-flash-lite',createdAt:time,updatedAt:new Date(time.getTime()+3),
   messages:models.map((model,index)=>({sourceId:'source-message-'+index,role:'assistant',content:contents[index],mode:'general',model,attachments:[],isError:index===3,createdAt:new Date(time.getTime()+index)})),
  }]};
  await createPrismaAccountImportRepository(prisma).createImportedAccount(ownerId,input);
  const chat=await prisma.chat.findFirstOrThrow({where:{userId:ownerId,title}});
  const rowsBefore=await prisma.message.findMany({where:{chatId:chat.id},orderBy:{timelinePosition:'asc'}});
  assert.deepEqual(rowsBefore.map(message=>message.model),models);
  const history=createChatHistoryService({repository:createPrismaChatHistoryRepository(prisma),projectAccess:createFakeProjectAccess()});
  const historyDto=(await history.listUserChats(ownerId)).find(row=>row.id===chat.id)!;
  const session=await sessionsService.read(ownerId,chat.id),expected=models.map(model=>model??'');
  assert.deepEqual(historyDto.messages.map(message=>message.model),expected);
  assert.deepEqual(session.messages.map(message=>message.model),expected);
  assert.equal(session.messages[3].isError,true);assert.equal(historyDto.messages[3].isError,true);
  assert.deepEqual(await prisma.message.findMany({where:{chatId:chat.id},orderBy:{timelinePosition:'asc'}}),rowsBefore);
  const saved=await history.saveUserChat(ownerId,storedChatSchema.parse(historyDto));
  const reread=await sessionsService.read(ownerId,chat.id);
  assert.deepEqual(saved.messages.map(message=>message.model),expected);
  assert.deepEqual(reread.messages.map(message=>message.model),expected);assert.equal(reread.messages[3].isError,true);
  assert.deepEqual((await prisma.message.findMany({where:{chatId:chat.id},orderBy:{timelinePosition:'asc'}})).map(message=>message.model),expected);
  if(process.env.ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE)await writeFile(process.env.ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE,JSON.stringify({session},null,2));
 });
 for(const mode of ['explicit','auto','failed'] as const)it(`${mode}: keeps turn selection and persists only the concrete successful model`,async()=>{
  const sessionId=await repository.createManaged(ownerId,null,{clientSessionId:'model-session-'+randomUUID()}),scope={userId:ownerId,projectId:'',sessionId};
  const model=mode==='auto'?'auto':'gemini-2.5-flash',calls:string[]=[];
  const turnId=await repository.queueTurn(scope,{clientTurnId:randomUUID(),expectedSessionVersion:1,content:'Discuss a test',attachments:[],model,mode:'screenshot_review'});
  const reply=createChatService({chatWithAi:async input=>{
   calls.push(input.model!);if(mode==='failed'||(mode==='auto'&&calls.length===1))throw new AppError('Synthetic quota',429,'QUOTA_EXCEEDED');
   return {reply:JSON.stringify({reply:'Model discussion',proposal:null,proposalAction:'keep'}),model:input.model!,provider:input.provider};
  }}).createChatReply;
  // Narrow candidate discovery to this fixture; lease checks, reads and writes remain real.
  const database={...prisma,$transaction:prisma.$transaction.bind(prisma),testSessionTurn:{...prisma.testSessionTurn,
   findFirst:(input:Prisma.TestSessionTurnFindFirstArgs={})=>prisma.testSessionTurn.findFirst({...input,where:{AND:[input.where||{}, {sessionId}]}}),
  }} as typeof prisma;
  const worker=createTestSessionsWorker({database,intelligence:createTestSessionIntelligence(reply),recipes:{async queueGeneration(){assert.fail('A discussion cannot queue QA');},async queueReviewRetry(){assert.fail('A discussion cannot review QA');}} as never});
  await worker.processTurn();
  const turn=await prisma.testSessionTurn.findUniqueOrThrow({where:{id:turnId}}),session=await repository.get(scope);
  assert.equal(turn.model,model);assert.equal(session.messages.find(message=>message.role==='user')?.model,model);
  assert.equal(session.currentRequestId,null);assert.equal(await prisma.qaExecutionJob.count({where:{request:{testSessionId:sessionId}}}),0);
  if(mode==='failed'){assert.equal(turn.status,'FAILED');assert.equal(turn.errorCode,'QUOTA_EXCEEDED');assert.deepEqual(calls,[model]);assert.equal(session.messages.filter(message=>message.role==='assistant').length,0);}
  else{const concrete=mode==='auto'?'gemini-2.5-flash-lite':model;assert.equal(turn.status,'SUCCEEDED');assert.equal(session.messages.find(message=>message.role==='assistant')?.model,concrete);assert.ok(!calls.includes('auto'));assert.equal(calls.length,mode==='auto'?2:1);}
 });
});
