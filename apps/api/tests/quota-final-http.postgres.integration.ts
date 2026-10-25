import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{AI_ENABLED:'true',GUEST_AI_ENABLED:'false',GEMINI_API_KEY:'offline-final-review-only',AI_WORKFLOW_ROUTER_ENABLED:'false',AI_GLOBAL_CREDIT_LIMIT:'1',AI_GLOBAL_REQUEST_LIMIT:'1',AI_GLOBAL_DAILY_CREDIT_LIMIT:'1',AI_GLOBAL_DAILY_REQUEST_LIMIT:'1',AI_GLOBAL_MONTHLY_CREDIT_LIMIT:'1',AI_GLOBAL_MONTHLY_REQUEST_LIMIT:'1'});
const {prisma}=await import('../src/db/prisma.ts');
const {env}=await import('../src/config/env.ts');
const {createApp}=await import('../src/app.ts');
const {hashPassword,hashSessionToken}=await import('../src/modules/auth/auth.security.ts');
const {createCsrfToken}=await import('../src/middleware/csrf.middleware.ts');
const {aggregateQuotaUsage}=await import('../src/modules/usage/usage-quota.ts');
const {AI_USAGE_ACTIONS}=await import('../src/modules/usage/usage.types.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const ids:string[]=[],anonymousEvents:string[]=[],password='Review fixture password 42!';
async function owner(){const id=randomUUID(),token=randomUUID();ids.push(id);await prisma.user.create({data:{id,email:id+'@example.test',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),sessions:{create:{tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+600000)}}}});const csrf=createCsrfToken();return {id,headers:{'content-type':'application/json',cookie:`qa_session=${token}; ${env.csrfCookieName}=${csrf}`,[env.csrfHeaderName]:csrf}};}
afterEach(async()=>{const owned=ids.splice(0),events=anonymousEvents.splice(0);await prisma.usageEvent.deleteMany({where:{OR:[{userId:{in:owned}},{id:{in:events}}]}});await prisma.user.deleteMany({where:{id:{in:owned}}});});
after(()=>prisma.$disconnect());
async function localApp(){const app=createApp();let server:any;const url=await new Promise<string>(r=>{server=app.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+server.address().port));});return {url,close:()=>new Promise<void>((resolve,reject)=>{server.close((error:any)=>error?reject(error):resolve());server.closeAllConnections();})};}
const body=JSON.stringify({message:'Hello',history:[],mode:'general',model:'gemini-3.1-flash-lite'});
const sdkResponse=()=>Response.json({candidates:[{content:{role:'model',parts:[{text:'Offline answer'}]}}],usageMetadata:{promptTokenCount:500,candidatesTokenCount:500,totalTokenCount:1000}});

it('H1 authenticated deletion preserves global hour/day/month caps across three accounts',async()=>{
 const app=await localApp(),nativeFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input:any,init:any)=>{if(String(input).startsWith(app.url+'/'))return nativeFetch(input,init);assert.match(String(input),/^https:\/\/generativelanguage\.googleapis\.com\//);calls++;return sdkResponse();};
 const statuses:any[]=[];
 try{
  for(let n=0;n<3;n++){
   const account=await owner();const reply=await fetch(app.url+'/api/chat',{method:'POST',headers:account.headers,body});const replyBody=await reply.json();assert.equal(reply.status,n===0?200:429,JSON.stringify(replyBody));
   anonymousEvents.push(...(await prisma.usageEvent.findMany({where:{userId:account.id},select:{id:true}})).map(e=>e.id));
   if(n===0){
    const blocked=await fetch(app.url+'/api/chat',{method:'POST',headers:account.headers,body});assert.equal(blocked.status,429);assert.equal((await blocked.json()).code,'AI_USAGE_LIMIT_REACHED');
    const wrong=await fetch(app.url+'/api/account',{method:'DELETE',headers:account.headers,body:JSON.stringify({currentPassword:'wrong password'})});assert.equal(wrong.status,403);assert.equal((await wrong.json()).code,'CURRENT_PASSWORD_INVALID');
    assert.equal(await prisma.usageEvent.count({where:{userId:account.id}}),1);
   }
   const deleted=await fetch(app.url+'/api/account',{method:'DELETE',headers:account.headers,body:JSON.stringify({currentPassword:password})});assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{ok:true});
   const global=await aggregateQuotaUsage(prisma,{since:new Date(Date.now()-3600000),actions:AI_USAGE_ACTIONS});statuses.push({chat:reply.status,delete:deleted.status,global});
  }
  console.log('H1_PROOF',JSON.stringify({calls,limits:{hour:env.aiGlobalRequestLimit,day:env.aiGlobalDailyRequestLimit,month:env.aiGlobalMonthlyRequestLimit},statuses}));
  assert.equal(calls,1,'Deleting personal history must preserve the global spend/request budget');
 }finally{globalThis.fetch=nativeFetch;await app.close();}
});

it('H2 authenticated deletion preserves an active SDK hold and its late receipt',async()=>{
 const app=await localApp(),a=await owner(),b=await owner(),nativeFetch=globalThis.fetch;let calls=0,release:any,signal:any;const entered=new Promise<void>(r=>signal=r);
 globalThis.fetch=async(input:any,init:any)=>{if(String(input).startsWith(app.url+'/'))return nativeFetch(input,init);assert.match(String(input),/^https:\/\/generativelanguage\.googleapis\.com\//);calls++;if(calls===1){signal();await new Promise(r=>release=r);}return sdkResponse();};
 let first:Promise<Response>|undefined;
 try{
  first=fetch(app.url+'/api/chat',{method:'POST',headers:a.headers,body});await entered;
  anonymousEvents.push((await prisma.usageEvent.findFirstOrThrow({where:{userId:a.id}})).id);
  const blocked=await fetch(app.url+'/api/chat',{method:'POST',headers:b.headers,body});assert.equal(blocked.status,429);
  const deleted=await fetch(app.url+'/api/account',{method:'DELETE',headers:a.headers,body:JSON.stringify({currentPassword:password})});assert.equal(deleted.status,200);
  const second=await fetch(app.url+'/api/chat',{method:'POST',headers:b.headers,body});release();const result=await first;
  console.log('H2_PROOF',JSON.stringify({calls,blocked:blocked.status,deleted:deleted.status,second:second.status,first:result.status,firstError:(await result.json()).code,lostRows:await prisma.usageEvent.count({where:{userId:a.id}})}));
  assert.equal(second.status,429,'Active LLM exposure must survive account deletion');
  assert.equal(result.status,200);
 }finally{release?.();if(first)await first.catch(()=>{});globalThis.fetch=nativeFetch;await app.close();}
});

for(const [name,output] of [
 ['H3 valid JSON failing local summary schema','{"summary":"","openQuestions":[]}'],
 ['H4 malformed JSON summary','not valid JSON'],
])it(name+' still retains known usage and enforces quota',async()=>{
 const {createConversationSummaryRefreshService}=await import('../src/modules/conversation-summary/conversation-summary-refresh.service.ts');
 const {createPrismaConversationSummaryRepository}=await import('../src/modules/conversation-summary/conversation-summary.repository.ts');
 const {createConversationSummaryService}=await import('../src/modules/conversation-summary/conversation-summary.service.ts');
 const {createConversationSummaryUsageService}=await import('../src/modules/usage/conversation-summary-usage.service.ts');
 const {geminiConversationSummarizer}=await import('../src/modules/ai/summarization/gemini-conversation-summarizer.ts');
 const account=await owner(),time=new Date(),repo=createPrismaUsageRepository(prisma,()=>time),usage=createUsageService({repository:repo,now:()=>time,globalAiUsageGuard:{creditLimit:2,requestLimit:10,dailyCreditLimit:100,monthlyCreditLimit:100,dailyRequestLimit:100,monthlyRequestLimit:100,windowMs:3600000}});
 const summaryRepo=createPrismaConversationSummaryRepository(),service=createConversationSummaryService({repository:summaryRepo});
 const chat=await prisma.chat.create({data:{userId:account.id,title:'Valid JSON / invalid schema'}});
 await prisma.message.createMany({data:Array.from({length:12},(_,i)=>({chatId:chat.id,role:i%2?'ASSISTANT':'USER',content:'Saved turn',createdAt:new Date(time.getTime()+i)}))});
 let calls=0;const original=globalThis.fetch;
 globalThis.fetch=async(url:any)=>{assert.match(String(url),/^https:\/\/generativelanguage\.googleapis\.com\//);calls++;return Response.json({candidates:[{content:{role:'model',parts:[{text:output}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:1000,totalTokenCount:2000}});};
 try{
  const refresh=createConversationSummaryRefreshService({repository:summaryRepo,service,usage:createConversationSummaryUsageService(usage),summarizer:geminiConversationSummarizer});
  const results=[];for(let i=0;i<3;i++)results.push(await refresh.requestRefresh(account.id,chat.id));
  const events=await prisma.usageEvent.findMany({where:{userId:account.id},include:{settlementReceipts:true}});
  console.log('H3_PROOF',JSON.stringify({calls,results,actualCredits:calls*2,quotaExposure:events.reduce((n,e)=>n+e.units,0),verified:events.map(e=>e.creditsUsed),receipts:events.reduce((n,e)=>n+e.settlementReceipts.length,0)}));
  assert.equal(calls,1,'The first known 2-credit usage must exhaust the 2-credit budget even when its text is unusable');
 }finally{globalThis.fetch=original;}
});
