import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{AI_ENABLED:'true',GUEST_AI_ENABLED:'false',GEMINI_API_KEY:'offline-acceptance-only',AI_WORKFLOW_ROUTER_ENABLED:'false',AI_GLOBAL_CREDIT_LIMIT:'1000',AI_GLOBAL_REQUEST_LIMIT:'1000',AI_GLOBAL_USAGE_WINDOW_MS:'3600000',USAGE_WINDOW_HOURS:'960',USER_DAILY_CREDITS:'1',AI_GLOBAL_DAILY_CREDIT_LIMIT:'1000',AI_GLOBAL_DAILY_REQUEST_LIMIT:'1000',AI_GLOBAL_MONTHLY_CREDIT_LIMIT:'1000',AI_GLOBAL_MONTHLY_REQUEST_LIMIT:'1000',USAGE_RECORD_RETENTION_DAYS:'32',REGISTRATION_MODE:'public',EMAIL_PROVIDER:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',EMAIL_FROM:'offline@example.test',EMAIL_OUTBOX_ENCRYPTION_SECRET:'isolated-review-secret-not-production',AUTH_EMAIL_RESPONSE_FLOOR_MS:'0'});
const {prisma}=await import('../src/db/prisma.ts');
const {env}=await import('../src/config/env.ts');
const {createApp}=await import('../src/app.ts');
const {decryptAuthEmailPayload,buildAuthEmailPayloadContext}=await import('../src/modules/auth/auth-email-outbox.crypto.ts');
const {createPrismaUsageRepository}=await import('../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../src/modules/usage/usage.service.ts');
const {createChatService}=await import('../src/modules/chat/chat.service.ts');
const {chatWithGemini}=await import('../src/modules/ai/gemini.provider.ts');
const {createPrismaRetentionRepository}=await import('../src/modules/retention/retention.repository.ts');
const {createRetentionService,getConfiguredRetentionPolicy}=await import('../src/modules/retention/retention.service.ts');
const {aggregateQuotaUsage}=await import('../src/modules/usage/usage-quota.ts');
const ids:string[]=[],events:string[]=[],password='Acceptance fixture passphrase 481!';
const nativeFetch=globalThis.fetch;
const app=createApp(),server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
let calls=0;
globalThis.fetch=async(input:any,init:any)=>{if(String(input).startsWith(url+'/'))return nativeFetch(input,init);assert.match(String(input),/^https:\/\/generativelanguage\.googleapis\.com\//);calls++;return Response.json({candidates:[{content:{role:'model',parts:[{text:'Offline answer'}]}}],usageMetadata:{promptTokenCount:500,candidatesTokenCount:500,totalTokenCount:1000}});};
const input={message:'Hello',history:[],mode:'general' as const,model:'gemini-3.1-flash-lite'};
afterEach(async()=>{await prisma.usageEvent.deleteMany({where:{OR:[{userId:{in:ids}},{id:{in:events}}]}});await prisma.user.deleteMany({where:{id:{in:ids}}});ids.length=0;events.length=0;calls=0;});
after(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await prisma.$disconnect();});
async function registerAndLogin(email:string){
 const csrfResponse=await fetch(url+'/api/auth/csrf');assert.equal(csrfResponse.status,200);
 const csrf=await csrfResponse.json() as any;
 const cookie=csrfResponse.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const headers:Record<string,string>={'content-type':'application/json',cookie,[env.csrfHeaderName]:csrf.csrfToken};
 const registered=await fetch(url+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({email,password,termsAccepted:true,termsVersion:env.currentTermsVersion})});
 assert.equal(registered.status,201,JSON.stringify(await registered.json()));
 const user=await prisma.user.findUniqueOrThrow({where:{email}});ids.push(user.id);
 const job=await prisma.authEmailJob.findFirstOrThrow({where:{userId:user.id,kind:'EMAIL_VERIFICATION'}});
 const payload=decryptAuthEmailPayload(job.encryptedPayload!,{secret:env.emailOutboxEncryptionSecret,context:buildAuthEmailPayloadContext({jobId:job.id,userId:user.id,kind:'EMAIL_VERIFICATION'})});
 const token=new URL(payload.url).searchParams.get('token');assert.ok(token);
 const verified=await fetch(url+'/api/auth/verify-email',{method:'POST',headers,body:JSON.stringify({token,newPassword:password})});assert.equal(verified.status,200);
 const login=await fetch(url+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({email,password})});assert.equal(login.status,200,JSON.stringify(await login.json()));
 headers.cookie+='; '+login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return {id:user.id,headers};
}
async function send(headers:Record<string,string>){return fetch(url+'/api/chat',{method:'POST',headers,body:JSON.stringify(input)});}

it('T4 configured identity quota must survive retention when it outlasts all global windows',async()=>{
 const a=await registerAndLogin('retention-'+randomUUID()+'@example.test');
 const previous=new Date(Date.now()-33*86400000);
 const repo=createPrismaUsageRepository(prisma,()=>previous),usage=createUsageService({repository:repo,now:()=>previous});
 // The real SDK and durable writer create historical consumption through an
 // injected application clock. HTTP admission and retention use wall time.
 const service=createChatService({chatWithAi:chatWithGemini,reserveUsage:usage.reserveChatCredits,recordUsageAttempt:usage.recordAiOperationAttempt,completeUsage:usage.completeChatCredits,failUsage:usage.failChatCredits});
 await service.createChatReply(input,{userId:a.id});assert.equal(calls,1);
 const blocked=await send(a.headers);assert.equal(blocked.status,429);assert.equal((await blocked.json() as any).code,'USAGE_LIMIT_REACHED');
 const policy=getConfiguredRetentionPolicy();assert.equal(policy.usageDays,32);assert.equal(env.aiGlobalUsageWindowMs,3600000);assert.equal(env.usageWindowHours,960);
 const purge=await createRetentionService(createPrismaRetentionRepository(prisma)).purge(new Date(),policy);
 const response=await send(a.headers),body=await response.json();
 console.log('T4',JSON.stringify({identityDays:env.usageWindowHours/24,globalHours:env.aiGlobalUsageWindowMs/3600000,retentionDays:policy.usageDays,before:blocked.status,purged:purge.usageEvents,after:response.status,calls,code:(body as any).code}));
 assert.equal(response.status,429,'Configured identity budget cannot be reset by retention');assert.equal(calls,1);
});

