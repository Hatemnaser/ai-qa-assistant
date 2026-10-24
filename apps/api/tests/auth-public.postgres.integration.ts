import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {after,afterEach,it} from 'node:test';
import {Pool} from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {PrismaClient}=await import('../src/generated/prisma/client.ts');
const {createPrismaAuthRepository}=await import('../src/modules/auth/auth.repository.ts');
const {createAuthService}=await import('../src/modules/auth/auth.service.ts');
const {hashPassword,verifyPassword}=await import('../src/modules/auth/auth.security.ts');
const {createPrismaAuthAbuseRepository}=await import('../src/modules/auth/auth-abuse.repository.ts');
const {authAbuseKey}=await import('../src/modules/auth/auth-abuse.middleware.ts');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),ids:string[]=[],keys:string[]=[];
afterEach(async()=>{await prisma.authAbuseBucket.deleteMany({where:{key:{in:keys.splice(0)}}});await prisma.user.deleteMany({where:{id:{in:ids.splice(0)}}});});
after(async()=>{await pool.end();await prisma.$disconnect();});
async function owner(){const id=randomUUID();ids.push(id);return prisma.user.create({data:{id,email:id+'@example.test',passwordHash:await hashPassword('Original independent passphrase 827!'),emailVerifiedAt:new Date()}});}
async function waiting(app:string){for(let i=0;i<400;i++){const r=await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[app]);if(r.rowCount)return;await new Promise(r=>setTimeout(r,5));}assert.fail('Expected real PostgreSQL lock wait');}

for(const kind of ['reset','verification'] as const)it('token '+kind+' rejects expiry reached during a real auth lock wait',async()=>{
 const user=await owner(),start=new Date(),expiry=new Date(start.getTime()+60000),hash=randomUUID();let clock=start;
 if(kind==='reset')await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:hash,expiresAt:expiry}});
 else {await prisma.user.update({where:{id:user.id},data:{emailVerifiedAt:null}});await prisma.emailVerificationToken.create({data:{userId:user.id,tokenHash:hash,expiresAt:expiry}});}
 const app='auth-token-'+randomUUID(),db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,application_name:app})}),repo=createPrismaAuthRepository(db,()=>clock),lock=await pool.connect();let pending:Promise<boolean>|undefined;
 try {
  await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['oddpath:auth-token-state:'+user.id]);
  pending=kind==='reset'?repo.resetPasswordWithToken({tokenHash:hash,newPasswordHash:'must-not-be-written',now:start}):repo.verifyEmailWithToken({tokenHash:hash,newPasswordHash:'must-not-be-written',now:start});
  await waiting(app);clock=expiry;await lock.query('COMMIT');
  const result=await pending;assert.equal(result,false,'An expired token cannot be consumed after waiting for its lock');
  const unchanged=await prisma.user.findUniqueOrThrow({where:{id:user.id}});assert.equal(unchanged.passwordHash,user.passwordHash);
  if(kind==='verification')assert.equal(unchanged.emailVerifiedAt,null);
  console.log('AUTH_EXPIRY_PROOF',JSON.stringify({kind,actualLockWait:true,accepted:result}));
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;await db.$disconnect();}
});

it('login verified before password reset cannot create a session after reset finishes',async()=>{
 const user=await owner(),repo=createPrismaAuthRepository(),hash=randomUUID(),time=new Date();
 await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:hash,expiresAt:new Date(time.getTime()+60000)}});
 let entered!:()=>void,resume!:()=>void;const paused=new Promise<void>(r=>entered=r),ready=new Promise<void>(r=>resume=r);
 const service=createAuthService({repository:repo,security:{verifyPassword:async(password,stored)=>{const result=await verifyPassword(password,stored);entered();await ready;return result;}}});
 const outcome=Promise.allSettled([service.login({email:user.email,password:'Original independent passphrase 827!',remember:false},{})]);
 try {await paused;assert.equal(await repo.resetPasswordWithToken({tokenHash:hash,newPasswordHash:await hashPassword('Replacement independent passphrase 901!'),now:new Date()}),true);}
 finally {resume();}
 const [result]=await outcome;assert.equal(result.status,'rejected','Old credential verification must not outlive reset');
 if(result.status==='rejected')assert.equal(result.reason.code,'INVALID_CREDENTIALS');
 assert.equal(await prisma.session.count({where:{userId:user.id}}),0);
 console.log('AUTH_CREDENTIAL_RACE_PROOF',JSON.stringify({login:'rejected',sessions:0}));
});

it('shared budgets admit exactly the configured concurrent attempts and roll back a failed counter write',async()=>{
 const key=authAbuseKey('db-concurrent',randomUUID());keys.push(key);const repo=createPrismaAuthAbuseRepository();
 const outcomes=await Promise.all(Array.from({length:20},()=>repo.consume([{key,limit:3,windowMs:60000}])));
 assert.equal(outcomes.filter(r=>!r.limited).length,3);assert.equal((await prisma.authAbuseBucket.findUniqueOrThrow({where:{key}})).hits,3);
 const failing=authAbuseKey('db-failure',randomUUID()),other=authAbuseKey('db-failure-other',randomUUID());keys.push(failing,other);
 await pool.query(`CREATE FUNCTION auth_budget_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."key"='${failing}' THEN RAISE EXCEPTION 'isolated auth storage outage'; END IF; RETURN NEW; END $$`);
 await pool.query('CREATE TRIGGER auth_budget_failure BEFORE INSERT ON "AuthAbuseBucket" FOR EACH ROW EXECUTE FUNCTION auth_budget_failure()');
 try {await assert.rejects(repo.consume([{key:failing,limit:2,windowMs:60000},{key:other,limit:2,windowMs:60000}]));assert.equal(await prisma.authAbuseBucket.count({where:{key:{in:[failing,other]}}}),0);}
 finally {await pool.query('DROP TRIGGER auth_budget_failure ON "AuthAbuseBucket"');await pool.query('DROP FUNCTION auth_budget_failure()');}
 assert.equal((await repo.consume([{key:failing,limit:2,windowMs:60000}])).limited,false);
});

it('counter expiry uses a fresh database clock after a real lock wait and cleanup preserves active windows',async()=>{
 const key=authAbuseKey('expiry-lock',randomUUID());keys.push(key);
 // An active row can be aged while its lock is held. The consumer waits on
 // the real advisory lock; SQL time is read only after release.
 await prisma.authAbuseBucket.create({data:{key,hits:1,resetAt:new Date(Date.now()+60000)}});
 const app='auth-budget-'+randomUUID(),db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,application_name:app})}),repo=createPrismaAuthAbuseRepository(db),lock=await pool.connect();let pending:Promise<any>|undefined;
 try {
  await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['oddpath:auth-abuse:'+key]);
  pending=repo.consume([{key,limit:1,windowMs:60000}]);await waiting(app);
  await lock.query('UPDATE "AuthAbuseBucket" SET "resetAt"=clock_timestamp() AT TIME ZONE \'UTC\'-interval \'1 millisecond\' WHERE "key"=$1',[key]);await lock.query('COMMIT');
  assert.equal((await pending).limited,false);assert.equal((await prisma.authAbuseBucket.findUniqueOrThrow({where:{key}})).hits,1);
  await repo.cleanup();assert.equal(await prisma.authAbuseBucket.count({where:{key}}),1);
  await pool.query('UPDATE "AuthAbuseBucket" SET "resetAt"=clock_timestamp() AT TIME ZONE \'UTC\' WHERE "key"=$1',[key]);
  await repo.cleanup();assert.equal(await prisma.authAbuseBucket.count({where:{key}}),0);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;await db.$disconnect();}
});

it('the actual periodic retention command removes expired abuse data while preserving an active denied budget',async()=>{
 const active=authAbuseKey('scheduled-active',randomUUID()),expired=authAbuseKey('scheduled-expired',randomUUID());keys.push(active,expired);
 const repo=createPrismaAuthAbuseRepository();await repo.consume([{key:active,limit:1,windowMs:60000}]);
 await prisma.authAbuseBucket.create({data:{key:expired,hits:1,resetAt:new Date(Date.now()-1)}});
 const result=await promisify(execFile)(process.execPath,['--import','tsx','apps/api/src/scripts/cleanup-retention.ts'],{env:{...process.env,AUTH_ABUSE_STORE:'postgres'},windowsHide:true,timeout:30000});
 assert.match(result.stdout,/"event":"auth_abuse_cleanup"/);
 assert.equal(await prisma.authAbuseBucket.count({where:{key:expired}}),0);assert.equal((await repo.consume([{key:active,limit:1,windowMs:60000}])).limited,true);
});
