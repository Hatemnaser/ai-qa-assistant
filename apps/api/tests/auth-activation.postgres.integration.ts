import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {after,afterEach,beforeEach,it} from 'node:test';
import {Pool} from 'pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
Object.assign(process.env,{AUTH_ABUSE_STORE:'postgres',AI_ENABLED:'false',GUEST_AI_ENABLED:'false',GEMINI_API_KEY:'',REGISTRATION_MODE:'public',AUTH_EMAIL_RESPONSE_FLOOR_MS:'0',EMAIL_PROVIDER:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',EMAIL_FROM:'fixture@example.test',EMAIL_OUTBOX_ENCRYPTION_SECRET:'isolated-activation-secret-not-production',AUTH_LOGIN_RATE_LIMIT_MAX:'100',AUTH_REGISTER_RATE_LIMIT_MAX:'100',AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX:'100',AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX:'100',AUTH_RESET_PASSWORD_RATE_LIMIT_MAX:'100',AUTH_GLOBAL_RATE_LIMIT_MAX:'1000',AUTH_EMAIL_DAILY_MAX:'1000',AUTH_RECIPIENT_DAILY_MAX:'20'});
const {prisma}=await import('../src/db/prisma.ts');
const {env}=await import('../src/config/env.ts');
const {decryptAuthEmailPayload,buildAuthEmailPayloadContext}=await import('../src/modules/auth/auth-email-outbox.crypto.ts');
const {hashSessionToken,verifyPassword}=await import('../src/modules/auth/auth.security.ts');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),emails:string[]=[],workers:HttpWorker[]=[];
interface HttpWorker {url:string;stop:()=>Promise<void>}
type Client={url:string;headers:Record<string,string>};
const planted='Pre-registrant known passphrase 582!',chosen='Mailbox owner chosen passphrase 736!',replacement='Mailbox owner replacement phrase 917!';
beforeEach(async()=>{assert.equal(await prisma.user.count(),0,'Requires an empty disposable database');await prisma.authAbuseBucket.deleteMany();});
afterEach(async()=>{for(const w of workers.splice(0))await w.stop();await prisma.user.deleteMany({where:{email:{in:emails.splice(0)}}});await prisma.authAbuseBucket.deleteMany();});
after(async()=>{await pool.end();await prisma.$disconnect();});
function email(){const value=randomUUID()+'@example.test';emails.push(value);return value;}
async function worker():Promise<HttpWorker>{
 const child=spawn(process.execPath,['--import','tsx','apps/api/tests/fixtures/auth-public-worker.mts'],{env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let output='';child.stdout!.on('data',d=>output+=d);child.stderr!.on('data',d=>output+=d);const exit=once(child,'exit');
 const [ready]=await Promise.race([once(child,'message'),exit.then(()=>{throw Error('worker failed '+output);})]);let stopped=false;
 const result={url:'http://127.0.0.1:'+(ready as {port:number}).port,stop:async()=>{if(stopped)return;stopped=true;if(child.exitCode===null&&child.signalCode===null)child.send('stop');const [code]=await exit;assert.equal(code,0,output);}};workers.push(result);return result;
}
async function client(w:HttpWorker,ip='198.51.100.21'):Promise<Client>{const r=await fetch(w.url+'/api/auth/csrf');assert.equal(r.status,200);const body=await r.json() as {csrfToken:string};return {url:w.url,headers:{'content-type':'application/json','x-forwarded-for':ip,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),[env.csrfHeaderName]:body.csrfToken}};}
async function post(c:Client,route:string,body:unknown){const response=await fetch(c.url+'/api/auth'+route,{method:'POST',headers:c.headers,body:JSON.stringify(body)});return {response,status:response.status,body:await response.json() as Record<string,unknown>};}
const register=(c:Client,e:string,password=planted)=>post(c,'/register',{email:e,password,termsAccepted:true,termsVersion:env.currentTermsVersion});
const activate=(c:Client,token:string,newPassword=chosen)=>post(c,'/verify-email',{token,newPassword});
const login=(c:Client,e:string,password:string)=>post(c,'/login',{email:e,password});
async function token(e:string,kind:'EMAIL_VERIFICATION'|'PASSWORD_RESET'='EMAIL_VERIFICATION'){
 const user=await prisma.user.findUniqueOrThrow({where:{email:e}}),job=await prisma.authEmailJob.findFirstOrThrow({where:{userId:user.id,kind,status:'PENDING'}});const payload=decryptAuthEmailPayload(job.encryptedPayload!,{secret:env.emailOutboxEncryptionSecret,context:buildAuthEmailPayloadContext({jobId:job.id,userId:user.id,kind})});const url=new URL(payload.url);return new URLSearchParams(url.hash.split('?')[1]??url.search).get('token')!;
}

it('A1 activation must bind mailbox ownership to the owner-selected credential, never the pre-registrant password',async()=>{
 const w=await worker(),e=email(),attacker=await client(w,'198.51.100.10'),owner=await client(w,'198.51.100.11');
 assert.equal((await register(attacker,e)).status,201);assert.equal((await login(attacker,e,planted)).status,403);
 assert.equal((await register(owner,e,chosen)).status,201);
 // Before the repair, Zod strips newPassword and the old credential is activated.
 assert.equal((await activate(owner,await token(e),chosen)).status,200);
 const bad=await login(attacker,e,planted),good=await login(owner,e,chosen);
 console.log('ACTIVATION_A1',JSON.stringify({attackerLogin:bad.status,ownerLogin:good.status,sessions:await prisma.session.count()}));
 assert.equal(bad.status,401,'Never activate the pre-registrant credential');assert.equal(good.status,200);
 const cookie=good.response.headers.getSetCookie().find(v=>v.startsWith('qa_session='))!.split(';')[0];assert.equal((await fetch(w.url+'/api/auth/me',{headers:{cookie}})).status,200);
});

it('A2 token-only and weak-password activation fail without consuming the email proof',async()=>{
 const c=await client(await worker()),e=email();assert.equal((await register(c,e)).status,201);const proof=await token(e);
 assert.equal((await post(c,'/verify-email',{token:proof})).status,400);assert.equal((await activate(c,proof,'weak')).status,400);assert.equal((await prisma.user.findUniqueOrThrow({where:{email:e}})).emailVerifiedAt,null);
 assert.equal((await activate(c,proof)).status,200);assert.equal((await login(c,e,planted)).status,401);assert.equal((await login(c,e,chosen)).status,200);
});

it('A3 resend alone never activates a planted password; old proof and reset tokens and sessions are revoked',async()=>{
 const c=await client(await worker()),e=email();assert.equal((await register(c,e)).status,201);const oldProof=await token(e),u=await prisma.user.findUniqueOrThrow({where:{email:e}}),session=randomUUID();
 await prisma.session.create({data:{userId:u.id,tokenHash:hashSessionToken(session),expiresAt:new Date(Date.now()+600000)}});
 assert.equal((await post(c,'/forgot-password',{email:e})).status,200);const oldReset=await token(e,'PASSWORD_RESET');
 assert.equal((await post(c,'/resend-verification',{email:e})).status,200);const current=await token(e);
 assert.equal((await activate(c,oldProof)).status,400);assert.equal((await activate(c,current)).status,200);assert.equal((await activate(c,current,replacement)).status,400);
 assert.equal((await post(c,'/reset-password',{token:oldReset,newPassword:planted})).status,400);
 assert.equal((await fetch(c.url+'/api/auth/me',{headers:{cookie:'qa_session='+session}})).status,401);assert.equal(await prisma.session.count({where:{userId:u.id}}),0);
 assert.equal(await prisma.emailVerificationToken.count({where:{userId:u.id,usedAt:null}}),0);assert.equal(await prisma.passwordResetToken.count({where:{userId:u.id,usedAt:null}}),0);
 assert.equal(await prisma.authEmailJob.count({where:{userId:u.id,status:{in:['PENDING','PROCESSING']}}}),0);
 assert.equal((await login(c,e,planted)).status,401);assert.equal((await login(c,e,chosen)).status,200);
});

it('A4 concurrent re-registration/resend cannot select the credential activated by the mailbox owner',async()=>{
 const a=await client(await worker()),b=await client(await worker(),'198.51.100.22'),e=email();await register(a,e);const old=await token(e);
 const results=await Promise.all([register(a,e,planted),register(b,e,replacement),post(a,'/resend-verification',{email:e}),register(b,e,planted)]);assert.deepEqual(results.map(r=>r.status),[201,201,200,201]);
 assert.equal(await prisma.user.count({where:{email:e}}),1);assert.equal((await activate(a,old)).status,400);
 assert.equal((await activate(a,await token(e),chosen)).status,200);assert.equal((await login(a,e,planted)).status,401);assert.equal((await login(a,e,replacement)).status,401);assert.equal((await login(a,e,chosen)).status,200);
 const u=await prisma.user.findUniqueOrThrow({where:{email:e}});assert.equal(await prisma.emailVerificationToken.count({where:{userId:u.id,usedAt:null}}),0);
});

it('A5 one proof permits only one concurrent activation with different credentials',async()=>{
 const a=await client(await worker()),b=await client(await worker(),'198.51.100.23'),e=email();await register(a,e);const proof=await token(e);
 const result=await Promise.all([activate(a,proof,chosen),activate(b,proof,replacement)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,400]);const winner=result[0].status===200?chosen:replacement,loser=result[0].status===200?replacement:chosen;
 assert.equal((await login(a,e,winner)).status,200);assert.equal((await login(a,e,loser)).status,401);assert.equal((await login(a,e,planted)).status,401);
});

it('A6 unverified password reset invalidates old activation proofs; verified reset remains authoritative',async()=>{
 const c=await client(await worker()),e=email();await register(c,e);const oldProof=await token(e);await post(c,'/forgot-password',{email:e});const reset=await token(e,'PASSWORD_RESET');
 assert.equal((await post(c,'/reset-password',{token:reset,newPassword:replacement})).status,200);assert.equal((await activate(c,oldProof,planted)).status,400);assert.equal((await prisma.user.findUniqueOrThrow({where:{email:e}})).emailVerifiedAt,null);
 await post(c,'/resend-verification',{email:e});assert.equal((await activate(c,await token(e),chosen)).status,200);
 await post(c,'/forgot-password',{email:e});const freshReset=await token(e,'PASSWORD_RESET');assert.equal((await post(c,'/reset-password',{token:freshReset,newPassword:replacement})).status,200);
 assert.equal((await login(c,e,chosen)).status,401);assert.equal((await login(c,e,replacement)).status,200);
});

it('A7 activation persistence failure rolls back password, verification, proof and sessions before a safe retry',async()=>{
 const c=await client(await worker()),e=email();await register(c,e);const proof=await token(e),u=await prisma.user.findUniqueOrThrow({where:{email:e}});await prisma.session.create({data:{userId:u.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
 await pool.query(`CREATE FUNCTION activation_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."userId"='${u.id}' THEN RAISE EXCEPTION 'isolated activation persistence failure'; END IF; RETURN OLD; END $$`);await pool.query('CREATE TRIGGER activation_fail BEFORE DELETE ON "Session" FOR EACH ROW EXECUTE FUNCTION activation_fail()');
 try{assert.equal((await activate(c,proof)).status,500);const unchanged=await prisma.user.findUniqueOrThrow({where:{id:u.id}});assert.equal(unchanged.passwordHash,u.passwordHash);assert.equal(unchanged.emailVerifiedAt,null);assert.equal(await prisma.emailVerificationToken.count({where:{userId:u.id,usedAt:null}}),1);assert.equal(await prisma.session.count({where:{userId:u.id}}),1);}
 finally{await pool.query('DROP TRIGGER activation_fail ON "Session"');await pool.query('DROP FUNCTION activation_fail()');}
 assert.equal((await activate(c,proof)).status,200);assert.equal((await login(c,e,planted)).status,401);assert.equal((await login(c,e,chosen)).status,200);
});

it('A8 activation survives API restart and verified-account duplicates stay generic without replacing credentials',async()=>{
 const w=await worker(),c=await client(w),e=email();const initial=await register(c,e);const proof=await token(e);await w.stop();const fresh=await client(await worker());assert.equal((await activate(fresh,proof)).status,200);
 const duplicate=await register(fresh,e,planted),unknown=await register(fresh,email(),planted);assert.equal(duplicate.status,initial.status);assert.deepEqual(duplicate.body,initial.body);assert.deepEqual(unknown.body,initial.body);
 const absent=await post(fresh,'/resend-verification',{email:email()}),existing=await post(fresh,'/resend-verification',{email:e});assert.equal(existing.status,absent.status);assert.deepEqual(existing.body,absent.body);
 const u=await prisma.user.findUniqueOrThrow({where:{email:e}});assert.equal(await prisma.authEmailJob.count({where:{userId:u.id,status:{in:['PENDING','PROCESSING']}}}),0);assert.equal(await verifyPassword(chosen,u.passwordHash!),true);assert.equal((await activate(fresh,proof,replacement)).status,400);
});
