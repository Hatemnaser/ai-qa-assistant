import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {after,afterEach,beforeEach,it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{AUTH_ABUSE_STORE:'postgres',AI_ENABLED:'true',GUEST_AI_ENABLED:'false',GEMINI_API_KEY:'',REGISTRATION_MODE:'public',AUTH_EMAIL_RESPONSE_FLOOR_MS:'0',EMAIL_PROVIDER:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',EMAIL_FROM:'offline@example.test',EMAIL_OUTBOX_ENCRYPTION_SECRET:'isolated-auth-public-test-secret',AUTH_LOGIN_RATE_LIMIT_MAX:'3',AUTH_GLOBAL_RATE_LIMIT_MAX:'30',AUTH_EMAIL_DAILY_MAX:'3',AUTH_RECIPIENT_DAILY_MAX:'2'});
const {prisma}=await import('../src/db/prisma.ts');
const {env}=await import('../src/config/env.ts');
const {decryptAuthEmailPayload,buildAuthEmailPayloadContext}=await import('../src/modules/auth/auth-email-outbox.crypto.ts');
interface HttpWorker {url:string;output:()=>string;stop:()=>Promise<void>;crash:()=>Promise<void>}
const pool=new Pool({connectionString:process.env.DATABASE_URL}),emails:string[]=[],workers:HttpWorker[]=[];
const password='Public HTTP fixture passphrase 639!',newPassword='Replacement HTTP passphrase 824!';
beforeEach(async()=>{assert.equal(await prisma.user.count(),0,'Dedicated disposable HTTP database must be empty');await prisma.authAbuseBucket.deleteMany();});
afterEach(async()=>{for(const w of workers.splice(0))await w.stop();await prisma.user.deleteMany({where:{email:{in:emails.splice(0)}}});await prisma.authAbuseBucket.deleteMany();});
after(async()=>{await pool.end();await prisma.$disconnect();});
function email(){const e=randomUUID()+'@example.test';emails.push(e);return e;}
async function worker(overrides:Record<string,string>={}):Promise<HttpWorker>{
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/auth-public-worker.mts'],{env:{...process.env,...overrides},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let output='';child.stdout!.on('data',d=>output+=d);child.stderr!.on('data',d=>output+=d);const exit=once(child,'exit');
 const [ready]=await Promise.race([once(child,'message'),exit.then(()=>{throw Error('HTTP worker exited: '+output);})]);
 let crashed=false;
 const result={url:'http://127.0.0.1:'+(ready as {port:number}).port,output:()=>output,stop:async()=>{if(crashed)return;if(child.exitCode===null&&child.signalCode===null)child.send('stop');const [code]=await exit;assert.equal(code,0,output);},crash:async()=>{crashed=true;assert.equal(child.kill('SIGKILL'),true);await exit;}};
 workers.push(result);return result;
}
async function client(w:Awaited<ReturnType<typeof worker>>,ip='198.51.100.31'){
 const r=await fetch(w.url+'/api/auth/csrf');assert.equal(r.status,200);const csrf=await r.json() as any;
 return {url:w.url,headers:{'content-type':'application/json','x-forwarded-for':ip,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),[env.csrfHeaderName]:csrf.csrfToken}};
}
async function post(c:Awaited<ReturnType<typeof client>>,path:string,body:unknown){const response=await fetch(c.url+'/api/auth'+path,{method:'POST',headers:c.headers,body:JSON.stringify(body)});return {response,status:response.status,body:await response.json() as any};}
async function token(e:string,kind:'EMAIL_VERIFICATION'|'PASSWORD_RESET'){
 const user=await prisma.user.findUniqueOrThrow({where:{email:e}}),job=await prisma.authEmailJob.findFirstOrThrow({where:{userId:user.id,kind,status:'PENDING'},orderBy:{createdAt:'desc'}});
 const p=decryptAuthEmailPayload(job.encryptedPayload!,{secret:env.emailOutboxEncryptionSecret,context:buildAuthEmailPayloadContext({jobId:job.id,userId:user.id,kind})});
 const u=new URL(p.url);return new URLSearchParams(u.hash.split('?')[1]??u.search).get('token')!;
}
const register=(c:Awaited<ReturnType<typeof client>>,e:string)=>post(c,'/register',{email:e,password,termsAccepted:true,termsVersion:env.currentTermsVersion});

it('H1 email attempts persist across two API processes and a third fresh process',async()=>{
 const a=await worker(),b=await worker(),e=email();
 for(let i=0;i<3;i++){const c=await client(i%2?a:b,'198.51.100.'+(40+i));const r=await post(c,'/login',{email:i===1?' '+e.toUpperCase()+' ':e,password});assert.equal(r.status,401);assert.equal(r.body.code,'INVALID_CREDENTIALS');}
 await a.crash();
 const third=await worker(),blocked=await post(await client(third,'198.51.100.49'),'/login',{email:e,password});
 assert.equal(blocked.status,429);assert.equal(blocked.body.code,'RATE_LIMITED');assert.ok(Number(blocked.response.headers.get('Retry-After'))>0);
 const rows=await prisma.authAbuseBucket.findMany();assert.doesNotMatch(JSON.stringify(rows),new RegExp(e));assert.ok(rows.every(r=>/^[a-f0-9]{64}$/.test(r.key)));
 console.log('AUTH_RESTART_PROOF',JSON.stringify({processes:3,attempts:[401,401,401,429],emailStored:false}));
});

it('H2 pre-body IP limits include malformed bodies, equivalent paths and spoofed forwarding prefixes',async()=>{
 const a=await worker();
 for(let i=0;i<4;i++){
  const c=await client(a,'203.0.113.'+(50+i)+', 198.51.100.55');
  const r=await fetch(c.url+'/api/auth/'+(i%2?'LOGIN/':'login'),{method:'POST',headers:c.headers,body:'{'});
  assert.equal(r.status,i<3?400:429);if(i===3){assert.equal((await r.json() as any).code,'RATE_LIMITED');assert.equal(r.headers.get('connection'),'close');}
 }
 assert.equal(await prisma.user.count(),0);
});

it('H3 recipient mail budget is shared across register/resend/reset and global mail budget spans identities',async()=>{
 const a=await worker(),e=email(),c=await client(a);
 assert.equal((await register(c,e)).status,201);assert.equal((await post(c,'/resend-verification',{email:e})).status,200);
 assert.equal((await post(await client(a,'198.51.100.32'),'/forgot-password',{email:e})).status,429);
 const other=email();assert.equal((await register(await client(a,'198.51.100.33'),other)).status,201);
 const rejected=email();assert.equal((await register(await client(a,'198.51.100.34'),rejected)).status,429);
 assert.equal(await prisma.user.count({where:{email:rejected}}),0);
 assert.equal(await prisma.authEmailJob.count({where:{status:'PENDING'}}),2);
 console.log('AUTH_MAIL_BUDGET_PROOF',JSON.stringify({recipientAllowed:2,recipientThird:429,globalAllowed:3,globalFourth:429}));
});

it('H4 HTTP registration/verification/login/reset stays generic, one-use, session-safe and CSRF protected',async()=>{
 const a=await worker({AUTH_RECIPIENT_DAILY_MAX:'5',AUTH_EMAIL_DAILY_MAX:'20',AUTH_LOGIN_RATE_LIMIT_MAX:'10'}),c=await client(a),e=email();
 const registered=await register(c,e);assert.equal(registered.status,201);assert.ok(!registered.response.headers.getSetCookie().some(v=>v.startsWith('qa_session=')));
 const unverified=await post(c,'/login',{email:e,password});assert.equal(unverified.status,403);assert.equal(unverified.body.code,'EMAIL_NOT_VERIFIED');
 const duplicate=await register(c,e);assert.equal(duplicate.status,201);assert.deepEqual(duplicate.body,registered.body);
 const verification=await token(e,'EMAIL_VERIFICATION');assert.ok(verification);
 assert.equal((await post(c,'/verify-email',{token:verification,newPassword:password})).status,200);assert.equal((await post(c,'/verify-email',{token:verification,newPassword:password})).status,400);
 const logged=await post(c,'/login',{email:e,password});assert.equal(logged.status,200);
 const sessionCookie=logged.response.headers.getSetCookie().find(v=>v.startsWith('qa_session='))!;assert.match(sessionCookie,/HttpOnly/i);assert.match(sessionCookie,/SameSite=Lax/i);assert.doesNotMatch(JSON.stringify(logged.body),/passwordHash|sessionToken/);
 const sessionHeaders={...c.headers,cookie:c.headers.cookie+'; '+sessionCookie.split(';')[0]};
 assert.equal((await fetch(c.url+'/api/auth/me',{headers:sessionHeaders})).status,200);
 assert.equal((await post(c,'/forgot-password',{email:e})).status,200);const reset=await token(e,'PASSWORD_RESET');
 const result=await post(c,'/reset-password',{token:reset,newPassword});assert.equal(result.status,200);
 assert.equal((await fetch(c.url+'/api/auth/me',{headers:sessionHeaders})).status,401);
 assert.equal((await post(c,'/reset-password',{token:reset,newPassword})).status,400);
 assert.equal((await post(c,'/login',{email:e,password})).status,401);
 const fresh=await post(c,'/login',{email:e,password:newPassword});assert.equal(fresh.status,200);
 const noCsrf=await fetch(c.url+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:newPassword})});assert.equal(noCsrf.status,403);
 const badOrigin=await fetch(c.url+'/api/auth/login',{method:'POST',headers:{...c.headers,origin:'https://untrusted.example'},body:JSON.stringify({email:e,password:newPassword})});assert.equal(badOrigin.status,403);
 const absent=await post(c,'/forgot-password',{email:email()}),existing=await post(c,'/forgot-password',{email:e});assert.equal(absent.status,200);assert.equal(existing.status,200);assert.deepEqual(absent.body,existing.body);
 assert.ok(!a.output().includes(verification));assert.ok(!a.output().includes(reset));assert.ok(!a.output().includes(password));
});

it('H5 PostgreSQL protection failure is 503 with zero account/token/mail side effects, then safely recovers',async()=>{
 const a=await worker(),c=await client(a),e=email();
 await pool.query(`CREATE FUNCTION public_auth_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private storage failure'; END $$`);
 await pool.query('CREATE TRIGGER public_auth_failure BEFORE INSERT ON "AuthAbuseBucket" FOR EACH ROW EXECUTE FUNCTION public_auth_failure()');
 try {const r=await register(c,e);assert.equal(r.status,503);assert.equal(r.body.code,'AUTH_PROTECTION_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(r.body),/private storage|postgres|SELECT|INSERT/);assert.equal(await prisma.user.count(),0);assert.equal(await prisma.authEmailJob.count(),0);}
 finally {await pool.query('DROP TRIGGER public_auth_failure ON "AuthAbuseBucket"');await pool.query('DROP FUNCTION public_auth_failure()');}
 assert.equal((await register(c,e)).status,201);assert.equal(await prisma.user.count({where:{email:e}}),1);
});

it('H6 rotating IPs cannot exceed the shared global mutation budget',async()=>{
 const a=await worker({AUTH_GLOBAL_RATE_LIMIT_MAX:'4'});
 const clients=await Promise.all(Array.from({length:10},(_,i)=>client(a,'198.51.100.'+(100+i))));
 const responses=await Promise.all(clients.map(c=>post(c,'/login',{})));
 assert.equal(responses.filter(r=>r.status===400).length,4);assert.equal(responses.filter(r=>r.status===429).length,6);
 assert.equal(await prisma.user.count(),0);
 console.log('AUTH_GLOBAL_PROOF',JSON.stringify({concurrentRequests:10,admittedToValidation:4,limited:6}));
});

it('H7 deleting an account and signing up again cannot reset the recipient abuse window',async()=>{
 const a=await worker(),c=await client(a),e=email();assert.equal((await register(c,e)).status,201);
 const old=await prisma.user.findUniqueOrThrow({where:{email:e}});
 assert.equal((await post(c,'/verify-email',{token:await token(e,'EMAIL_VERIFICATION'),newPassword:password})).status,200);
 const logged=await post(c,'/login',{email:e,password});assert.equal(logged.status,200);
 const cookie=logged.response.headers.getSetCookie().find(v=>v.startsWith('qa_session='))!.split(';')[0];
 const deleted=await fetch(c.url+'/api/account',{method:'DELETE',headers:{...c.headers,cookie:c.headers.cookie+'; '+cookie},body:JSON.stringify({currentPassword:password})});assert.equal(deleted.status,200);
 assert.equal(await prisma.user.count({where:{id:old.id}}),0);
 assert.equal((await register(await client(a,'198.51.100.61'),e)).status,201);
 const fresh=await prisma.user.findUniqueOrThrow({where:{email:e}});assert.notEqual(fresh.id,old.id);
 const third=await post(await client(a,'198.51.100.62'),'/resend-verification',{email:e});assert.equal(third.status,429);assert.equal(third.body.code,'RATE_LIMITED');
 assert.doesNotMatch(JSON.stringify(await prisma.authAbuseBucket.findMany()),new RegExp(e+'|'+old.id));
});
