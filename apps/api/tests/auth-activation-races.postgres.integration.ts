import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,afterEach,it} from 'node:test';
import {Pool} from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../src/db/prisma.ts');
const {PrismaClient}=await import('../src/generated/prisma/client.ts');
const {createPrismaAuthRepository}=await import('../src/modules/auth/auth.repository.ts');
const {createAuthService}=await import('../src/modules/auth/auth.service.ts');
const pool=new Pool({connectionString:process.env.DATABASE_URL}),ids:string[]=[];
afterEach(async()=>{await prisma.user.deleteMany({where:{id:{in:ids.splice(0)}}});});
after(async()=>{await pool.end();await prisma.$disconnect();});
async function owner(){const id=randomUUID();ids.push(id);return prisma.user.create({data:{id,email:id+'@example.test',passwordHash:'planted-hash'}});}
async function proof(userId:string,kind:'verify'|'reset'){
 const data={userId,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)};
 return kind==='verify'?prisma.emailVerificationToken.create({data}):prisma.passwordResetToken.create({data});
}
async function waiting(app:string){for(let i=0;i<400;i++){
 const r=await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[app]);
 if(r.rowCount)return;await new Promise(r=>setTimeout(r,5));
}assert.fail('Expected an actual PostgreSQL lock wait');}

for(const mode of ['direct','outbox'] as const)for(const operation of ['resend','forgot'] as const)for(const transition of ['verify','reset'] as const)
it(`${operation}/${mode}: a stale account lookup cannot issue a link after ${transition}`,async()=>{
 const u=await owner(),repo=createPrismaAuthRepository(),p=await proof(u.id,transition);let resume!:()=>void,entered!:()=>void,sends=0;
 const paused=new Promise<void>(r=>entered=r),ready=new Promise<void>(r=>resume=r);
 const service=createAuthService({authEmailResponseFloorMs:0,emailDeliveryMode:mode,emailOutboxEncryptionSecret:'isolated-race-test-secret',
  emailService:{sendEmailVerificationEmail:async()=>{sends++;},sendPasswordResetEmail:async()=>{sends++;}},
  repository:{...repo,findUserByEmail:async email=>{const snapshot=await repo.findUserByEmail(email);entered();await ready;return snapshot;}}});
 const outcome=Promise.allSettled([operation==='resend'?service.resendVerification({email:u.email}):service.requestPasswordReset({email:u.email})]);
 try{await paused;assert.equal(await (transition==='verify'?repo.verifyEmailWithToken({tokenHash:p.tokenHash,newPasswordHash:'owner-hash',now:new Date()}):repo.resetPasswordWithToken({tokenHash:p.tokenHash,newPasswordHash:'owner-hash',now:new Date()})),true);}
 finally{resume();}
 assert.equal((await outcome)[0].status,'fulfilled','Public response remains generic');
 assert.equal(sends,0);assert.equal(await prisma.authEmailJob.count({where:{userId:u.id}}),0);
 assert.equal(await prisma.emailVerificationToken.count({where:{userId:u.id,usedAt:null}}),0);
 assert.equal(await prisma.passwordResetToken.count({where:{userId:u.id,usedAt:null}}),0);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).passwordHash,'owner-hash');
});

for(const kind of ['verify','reset'] as const)it(`${kind}: expiry during the User row lock is checked after the wait`,async()=>{
 const u=await owner(),p=await proof(u.id,kind),start=new Date();let clock=start;
 const app='activation-user-lock-'+randomUUID(),db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,application_name:app})}),repo=createPrismaAuthRepository(db,()=>clock),lock=await pool.connect();let pending:Promise<boolean>|undefined;
 try{await lock.query('BEGIN');await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[u.id]);
  pending=kind==='verify'?repo.verifyEmailWithToken({tokenHash:p.tokenHash,newPasswordHash:'must-not-write',now:start}):repo.resetPasswordWithToken({tokenHash:p.tokenHash,newPasswordHash:'must-not-write',now:start});
  await waiting(app);clock=p.expiresAt;await lock.query('COMMIT');assert.equal(await pending,false);
  const row=await prisma.user.findUniqueOrThrow({where:{id:u.id}});assert.equal(row.passwordHash,u.passwordHash);assert.equal(row.emailVerifiedAt,null);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;await db.$disconnect();}
});

for(const first of ['verify','reset'] as const)it(`concurrent activation/reset: ${first} wins, and revokes the other operation`,async()=>{
 const u=await owner(),v=await proof(u.id,'verify'),r=await proof(u.id,'reset');
 const app='activation-race-'+randomUUID(),db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,application_name:app})}),repo=createPrismaAuthRepository(db),other=createPrismaAuthRepository(),lock=await pool.connect();let pending:Promise<boolean>|undefined,late:Promise<boolean>|undefined;
 try{await lock.query('BEGIN');await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[u.id]);
  pending=first==='verify'?repo.verifyEmailWithToken({tokenHash:v.tokenHash,newPasswordHash:'verified-owner',now:new Date()}):repo.resetPasswordWithToken({tokenHash:r.tokenHash,newPasswordHash:'reset-owner',now:new Date()});
  await waiting(app); // Winner holds the auth fence while waiting on the real User row.
  late=first==='verify'?other.resetPasswordWithToken({tokenHash:r.tokenHash,newPasswordHash:'loser',now:new Date()}):other.verifyEmailWithToken({tokenHash:v.tokenHash,newPasswordHash:'loser',now:new Date()});
  await lock.query('COMMIT');assert.equal(await pending,true);assert.equal(await late,false);
  const row=await prisma.user.findUniqueOrThrow({where:{id:u.id}});assert.equal(row.passwordHash,first==='verify'?'verified-owner':'reset-owner');assert.equal(Boolean(row.emailVerifiedAt),first==='verify');
  assert.equal(await prisma.emailVerificationToken.count({where:{userId:u.id,usedAt:null}}),0);assert.equal(await prisma.passwordResetToken.count({where:{userId:u.id,usedAt:null}}),0);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending;if(late)await late;await db.$disconnect();}
});

it('a legacy unused verification proof cannot change an already verified account',async()=>{
 const u=await owner(),p=await proof(u.id,'verify');await prisma.user.update({where:{id:u.id},data:{emailVerifiedAt:new Date(),passwordHash:'current-owner'}});
 assert.equal(await createPrismaAuthRepository().verifyEmailWithToken({tokenHash:p.tokenHash,newPasswordHash:'old-link-password',now:new Date()}),false);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).passwordHash,'current-owner');
});

it('delayed issuance cannot recreate a deleted account or outbox work',async()=>{
 const u=await owner(),repo=createPrismaAuthRepository();await prisma.user.delete({where:{id:u.id}});
 const input={userId:u.id,expectedPasswordHash:u.passwordHash,tokenHash:randomUUID(),now:new Date(),expiresAt:new Date(Date.now()+60000)};
 assert.equal(await repo.createEmailVerificationToken(input),false);assert.equal(await repo.createPasswordResetToken(input),false);
 assert.equal(await prisma.user.count({where:{id:u.id}}),0);assert.equal(await prisma.authEmailJob.count({where:{userId:u.id}}),0);
});
