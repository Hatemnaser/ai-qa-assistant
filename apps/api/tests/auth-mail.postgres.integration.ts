import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer,type Socket} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {after,afterEach,it} from 'node:test';
import {assertPostgresIntegrationTarget} from './helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
process.env.EMAIL_OUTBOX_ENCRYPTION_SECRET='isolated-smtp-recovery-secret';
const {prisma}=await import('../src/db/prisma.ts');
const {createAuthService}=await import('../src/modules/auth/auth.service.ts');
const {createPrismaAuthRepository}=await import('../src/modules/auth/auth.repository.ts');
const exec=promisify(execFile),ids:string[]=[];
afterEach(async()=>{await prisma.user.deleteMany({where:{id:{in:ids.splice(0)}}});});
after(()=>prisma.$disconnect());
async function seed(){
 const email=randomUUID()+'@example.test';await createAuthService({repository:createPrismaAuthRepository(),emailDeliveryMode:'outbox',emailOutboxEncryptionSecret:process.env.EMAIL_OUTBOX_ENCRYPTION_SECRET,authEmailResponseFloorMs:0}).register({email,password:'SMTP test fixture passphrase 928!',locale:'en',termsAccepted:true,termsVersion:'development-v1'},{});
 const user=await prisma.user.findUniqueOrThrow({where:{email}});ids.push(user.id);return prisma.authEmailJob.findFirstOrThrow({where:{userId:user.id,status:'PENDING'}});
}
async function smtp(failures:number){
 const sockets=new Set<Socket>(),messages:string[]=[];let remaining=failures;
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');socket.write('220 fixture ESMTP\r\n');
  let buffer='',data=false,lines:string[]=[];
  socket.on('data',chunk=>{buffer+=chunk;let index:number;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(data){if(line!=='.'){lines.push(line);continue;}data=false;messages.push(lines.join('\r\n'));lines=[];socket.write(remaining-->0?'451 fixture unavailable\r\n':'250 fixture accepted\r\n');}
   else if(/^EHLO|^HELO/i.test(line))socket.write('250-fixture\r\n250 PIPELINING\r\n');
   else if(/^MAIL FROM|^RCPT TO|^RSET/i.test(line))socket.write('250 OK\r\n');
   else if(/^DATA/i.test(line)){data=true;socket.write('354 End with dot\r\n');}
   else if(/^QUIT/i.test(line))socket.end('221 Bye\r\n');else socket.write('250 OK\r\n');
  }});
 });
 server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const port=(server.address() as {port:number}).port;
 return {messages,run:async(time:Date)=>{const r=await exec(process.execPath,['--import','tsx','apps/api/tests/fixtures/auth-mail-worker.mts',JSON.stringify({host:'127.0.0.1',port,time:time.toISOString()})],{env:process.env,windowsHide:true,timeout:30000});const line=r.stdout.split(/\r?\n/).find(l=>l.startsWith('{"event":"fixture_outbox"'));assert.ok(line);return JSON.parse(line);},close:async()=>{for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};
}
it('M1 real SMTP failure persists a retry; a fresh worker sends the same job with a stable Message-ID and clears its secret',async()=>{
 const job=await seed(),local=await smtp(1);
 try {
  const first=await local.run(new Date());assert.equal(first.retried,1);assert.equal(first.delivered,0);
  const pending=await prisma.authEmailJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(pending.status,'PENDING');assert.ok(pending.encryptedPayload);assert.equal(pending.lastErrorCode,'SMTP_DELIVERY_FAILED');
  const second=await local.run(new Date(pending.nextAttemptAt.getTime()+1));assert.equal(second.delivered,1);
  const sent=await prisma.authEmailJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(sent.status,'SENT');assert.equal(sent.encryptedPayload,null);assert.equal(sent.attempts,2);
  assert.equal(local.messages.length,2);for(const m of local.messages)assert.match(m,new RegExp('Message-ID: <'+job.id+'@oddpath.mail>','i'));
  await local.run(new Date(pending.nextAttemptAt.getTime()+2));assert.equal(local.messages.length,2);
  console.log('SMTP_RECOVERY_PROOF',JSON.stringify({workers:3,attempts:2,smtpResponses:[451,250],finalState:sent.status,payloadCleared:true}));
 }finally{await local.close();}
});
it('M2 a reclaimed job after the maximum possible attempts becomes terminal without another SMTP send',async()=>{
 const job=await seed(),local=await smtp(0),time=new Date();
 await prisma.authEmailJob.update({where:{id:job.id},data:{status:'PROCESSING',attempts:5,lockedAt:new Date(time.getTime()-6*60000)}});
 try {const r=await local.run(time);assert.equal(r.failed,1);assert.equal(r.delivered,0);assert.equal(local.messages.length,0);const stopped=await prisma.authEmailJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(stopped.status,'FAILED');assert.equal(stopped.encryptedPayload,null);}
 finally{await local.close();}
});
