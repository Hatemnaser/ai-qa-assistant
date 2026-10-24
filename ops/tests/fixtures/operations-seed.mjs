// Executed from the built image root against the rehearsal DB only, via stdin.
import { prisma as db } from './apps/api/dist/db/prisma.js';
import { hashPassword } from './apps/api/dist/modules/auth/auth.security.js';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {password}=JSON.parse(input),now=new Date();
try {
 await db.user.create({data:{id:'ops-user',email:'ops@example.invalid',name:'Synthetic recovery user',passwordHash:await hashPassword(password),emailVerifiedAt:now}});
 await db.project.create({data:{id:'ops-project',ownerId:'ops-user',name:'Recovery project'}});
 await db.chat.create({data:{id:'ops-chat',userId:'ops-user',projectId:'ops-project',title:'Recovery chat'}});
 await db.message.create({data:{id:'ops-message',chatId:'ops-chat',role:'USER',content:'Synthetic durable message'}});
 await db.projectDocument.create({data:{id:'ops-document',projectId:'ops-project',title:'Recovery document',content:'Synthetic project requirements'}});
 await db.projectMemory.create({data:{projectId:'ops-project',content:'Synthetic project memory'}});
 await db.memory.create({data:{id:'ops-memory',userId:'ops-user',scope:'USER',content:'Synthetic user memory'}});
 await db.session.create({data:{id:'ops-expired-session',userId:'ops-user',tokenHash:'synthetic-expired',expiresAt:new Date(now.getTime()-14*86400000)}});
 await db.usageEvent.create({data:{id:'ops-pending',userId:'ops-user',action:'chat',status:'settlement_pending',units:1,creditsReserved:1,providerAttempts:1,fixedCredits:0,reservationPolicy:{},expiresAt:new Date(now.getTime()+1800000)}});
 await db.usageProviderAttempt.create({data:{id:'ops-attempt',eventId:'ops-pending',ordinal:1,kind:'generation',creditsReserved:1}});
 await db.usageSettlementReceipt.create({data:{attemptId:'ops-attempt',eventId:'ops-pending',fingerprint:'synthetic-real-recovery',credits:2,payload:{id:'ops-pending',attemptId:'ops-attempt',status:'completed',creditsUsed:2,usageConfirmed:true}}});
 await db.usageEvent.create({data:{id:'ops-unknown',userId:'ops-user',action:'chat',status:'unknown',units:3,creditsReserved:3,providerAttempts:1,reservationPolicy:{},expiresAt:new Date(now.getTime()-1000)}});
 await db.usageProviderAttempt.create({data:{id:'ops-unknown-attempt',eventId:'ops-unknown',ordinal:1,kind:'generation',creditsReserved:3,status:'unknown'}});
 await db.usageEvent.create({data:{id:'ops-active-hold',userId:'ops-user',action:'chat',status:'reserved',units:5,creditsReserved:5,providerAttempts:0,reservationPolicy:{},expiresAt:new Date(now.getTime()+1800000)}});
 console.log(JSON.stringify({seeded:true}));
}finally{await db.$disconnect();}
